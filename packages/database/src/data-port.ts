import { decodeGrid, type DemGrid, type PointCloudStatistics } from "@massefelt/geometry";
import type {
  CrossSectionRecord,
  MeasurementRecord,
  ProjectDataPort,
  ScanDetail,
  ScanSummary,
  SurfaceSummary,
  VolumeRecord,
} from "@massefelt/tools";
import type { Vec3 } from "@massefelt/shared";
import type { Database } from "./index";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const scanInclude = {
  files: { orderBy: { createdAt: "asc" as const } },
  assets: {
    where: { kind: "POINT_CLOUD" as const },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: { pointCloud: true },
  },
};

type ScanRow = Awaited<ReturnType<Database["scan"]["findFirstOrThrow"]>> & {
  files: Awaited<ReturnType<Database["scanFile"]["findFirstOrThrow"]>>[];
  assets: (Awaited<ReturnType<Database["asset"]["findFirstOrThrow"]>> & {
    pointCloud: Awaited<ReturnType<Database["pointCloud"]["findFirstOrThrow"]>> | null;
  })[];
};

export function toScanSummary(scan: ScanRow): ScanSummary {
  const pc = scan.assets[0]?.pointCloud ?? null;
  return {
    id: scan.id,
    name: scan.name,
    status: scan.status,
    source: scan.source,
    acquisitionDate: iso(scan.acquisitionDate),
    crs: scan.crs,
    verticalDatum: scan.verticalDatum,
    units: scan.units,
    pointCount: pc?.pointCount ?? null,
    originalFilename: scan.files[0]?.originalFilename ?? null,
    createdAt: scan.createdAt.toISOString(),
  };
}

export function toScanDetail(scan: ScanRow): ScanDetail {
  const asset = scan.assets[0];
  const pc = asset?.pointCloud;
  return {
    ...toScanSummary(scan),
    statusMessage: scan.statusMessage,
    files: scan.files.map((f) => ({
      id: f.id,
      originalFilename: f.originalFilename,
      format: f.format,
      sizeBytes: Number(f.sizeBytes),
      sha256: f.sha256,
    })),
    pointCloud:
      asset && pc
        ? {
            assetId: asset.id,
            pointCount: pc.pointCount,
            bbox: { min: { x: pc.minX, y: pc.minY, z: pc.minZ }, max: { x: pc.maxX, y: pc.maxY, z: pc.maxZ } },
            origin: { x: pc.originX, y: pc.originY, z: pc.originZ },
            hasColor: pc.hasColor,
            hasIntensity: pc.hasIntensity,
            statistics: pc.statistics as unknown as PointCloudStatistics,
            provenance: {
              originalFilename: asset.originalFilename,
              source: asset.source,
              acquisitionDate: iso(asset.acquisitionDate),
              crs: asset.crs,
              verticalDatum: asset.verticalDatum,
              processingMethod: asset.processingMethod,
              processingVersion: asset.processingVersion,
              units: asset.units,
              parentAssetId: asset.parentAssetId,
              createdAt: asset.createdAt.toISOString(),
            },
          }
        : null,
  };
}

type MeasurementRow = Awaited<ReturnType<Database["measurement"]["findFirstOrThrow"]>>;

export function toMeasurementRecord(m: MeasurementRow): MeasurementRecord {
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    scanId: m.scanId,
    points: m.points as unknown as Vec3[],
    value: m.value,
    result: m.result as Record<string, unknown>,
    crs: m.crs,
    units: m.units,
    engineVersion: m.engineVersion,
    createdAt: m.createdAt.toISOString(),
  };
}

type SurfaceRow = Awaited<ReturnType<Database["asset"]["findFirstOrThrow"]>> & {
  surface: Awaited<ReturnType<Database["surface"]["findFirstOrThrow"]>> | null;
};

export function toSurfaceSummary(a: SurfaceRow): SurfaceSummary {
  const s = a.surface;
  return {
    id: a.id,
    name: a.name,
    scanId: a.scanId,
    surfaceType: s?.surfaceType ?? "GRID",
    cellSize: s?.resolution ?? null,
    cols: s?.cols ?? null,
    rows: s?.rows ?? null,
    aggregation: s?.aggregation ?? null,
    zMin: s?.zMin ?? null,
    zMax: s?.zMax ?? null,
    validCells: s?.validCells ?? null,
    filledCells: s?.filledCells ?? null,
    crs: a.crs,
    verticalDatum: a.verticalDatum,
    units: a.units,
    processingMethod: a.processingMethod,
    processingVersion: a.processingVersion,
    parentAssetId: a.parentAssetId,
    createdAt: a.createdAt.toISOString(),
  };
}

type VolumeRow = Awaited<ReturnType<Database["volumeCalculation"]["findFirstOrThrow"]>>;

export function toVolumeRecord(v: VolumeRow): VolumeRecord {
  return {
    id: v.id,
    name: v.name,
    method: v.method,
    topSurfaceId: v.topSurfaceAssetId,
    baseSurfaceId: v.baseSurfaceAssetId,
    referenceElevation: v.referenceElevation,
    boundary: (v.boundary as { x: number; y: number }[] | null) ?? null,
    area: v.area,
    volumeAbove: v.cut,
    volumeBelow: v.fill,
    net: v.net,
    result: (v.result as Record<string, unknown> | null) ?? {},
    crs: v.crs,
    units: v.units,
    engineVersion: v.engineVersion,
    createdAt: v.createdAt.toISOString(),
  };
}

type SectionRow = Awaited<ReturnType<Database["crossSection"]["findFirstOrThrow"]>>;

export function toCrossSectionRecord(c: SectionRow): CrossSectionRecord {
  return {
    id: c.id,
    name: c.name,
    surfaceId: c.surfaceAssetId,
    referenceSurfaceId: c.referenceSurfaceId,
    line: c.line as { x: number; y: number }[],
    length: c.length,
    interval: c.interval,
    result: (c.result as Record<string, unknown> | null) ?? {},
    crs: c.crs,
    units: c.units,
    engineVersion: c.engineVersion,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Reads raw bytes of a stored object (injected so this package does not depend on a storage driver). */
export type ObjectReader = (storageKey: string) => Promise<Uint8Array>;

/**
 * Prisma implementation of the tool data port. Every query is filtered by
 * projectId, so a tool can never read across project boundaries.
 */
export class PrismaProjectDataPort implements ProjectDataPort {
  constructor(
    private readonly db: Database,
    private readonly readObject?: ObjectReader,
  ) {}

  async getProject(projectId: string) {
    const p = await this.db.project.findUnique({
      where: { id: projectId },
      include: { _count: { select: { scans: true, measurements: true } } },
    });
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      defaultCrs: p.defaultCrs,
      defaultVerticalDatum: p.defaultVerticalDatum,
      units: p.units,
      createdAt: p.createdAt.toISOString(),
      scanCount: p._count.scans,
      measurementCount: p._count.measurements,
    };
  }

  async listScans(projectId: string) {
    const scans = await this.db.scan.findMany({ where: { projectId }, include: scanInclude, orderBy: { createdAt: "asc" } });
    return scans.map((s) => toScanSummary(s as ScanRow));
  }

  async getScan(projectId: string, scanId: string) {
    const scan = await this.db.scan.findFirst({ where: { id: scanId, projectId }, include: scanInclude });
    return scan ? toScanDetail(scan as ScanRow) : null;
  }

  async listMeasurements(projectId: string, filter?: { scanId?: string }) {
    const rows = await this.db.measurement.findMany({
      where: { projectId, ...(filter?.scanId ? { scanId: filter.scanId } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toMeasurementRecord);
  }

  async getMeasurement(projectId: string, measurementId: string) {
    const m = await this.db.measurement.findFirst({ where: { id: measurementId, projectId } });
    return m ? toMeasurementRecord(m) : null;
  }

  async listSurfaces(projectId: string) {
    const rows = await this.db.asset.findMany({
      where: { projectId, kind: "SURFACE" },
      include: { surface: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toSurfaceSummary);
  }

  async getSurface(projectId: string, surfaceId: string) {
    const a = await this.db.asset.findFirst({ where: { id: surfaceId, projectId, kind: "SURFACE" }, include: { surface: true } });
    return a ? toSurfaceSummary(a) : null;
  }

  async loadSurfaceGrid(projectId: string, surfaceId: string): Promise<DemGrid | null> {
    const a = await this.db.asset.findFirst({ where: { id: surfaceId, projectId, kind: "SURFACE" } });
    if (!a?.storageKey) return null;
    if (!this.readObject) throw new Error("PrismaProjectDataPort was created without an object reader");
    const bytes = await this.readObject(a.storageKey);
    return decodeGrid(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }

  async listVolumes(projectId: string) {
    const rows = await this.db.volumeCalculation.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
    return rows.map(toVolumeRecord);
  }

  async getVolume(projectId: string, volumeId: string) {
    const v = await this.db.volumeCalculation.findFirst({ where: { id: volumeId, projectId } });
    return v ? toVolumeRecord(v) : null;
  }

  async listCrossSections(projectId: string) {
    const rows = await this.db.crossSection.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
    return rows.map(toCrossSectionRecord);
  }

  async getCrossSection(projectId: string, crossSectionId: string) {
    const c = await this.db.crossSection.findFirst({ where: { id: crossSectionId, projectId } });
    return c ? toCrossSectionRecord(c) : null;
  }
}

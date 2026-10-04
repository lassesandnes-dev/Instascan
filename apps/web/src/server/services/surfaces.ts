import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildGridFromPointCloud,
  decodePointBuffer,
  encodeGrid,
  GEOMETRY_ENGINE_VERSION,
  summarizeGrid,
  type PointCloud,
} from "@massefelt/geometry";
import { AppError, NotFoundError, ValidationError, logger } from "@massefelt/shared";
import type { CurrentUser } from "../auth";
import { services } from "../context";
import { serverEnv } from "../env";
import { requireProject } from "./projects";

export const buildSurfaceSchema = z.object({
  cellSize: z.number().finite().min(0.01).max(1000),
  aggregation: z.enum(["mean", "min", "max"]).default("mean"),
  name: z.string().trim().max(200).optional(),
});

async function scanProject(user: CurrentUser, scanId: string) {
  const scan = await services().db.scan.findUnique({ where: { id: scanId } });
  if (!scan) throw new NotFoundError("Scan", scanId);
  await requireProject(user, scan.projectId);
  return scan;
}

/**
 * Build a DEM grid surface from a scan's point cloud. Runs inline (recorded as
 * a `surface.build` job) up to SURFACE_MAX_CELLS; the new asset's parent is
 * the point-cloud asset and it inherits CRS, datum and units unchanged.
 */
export async function buildSurface(user: CurrentUser, scanId: string, input: unknown) {
  const opts = buildSurfaceSchema.parse(input);
  const scan = await scanProject(user, scanId);
  const { db, storage, data } = services();
  const pcAsset = await db.asset.findFirst({
    where: { scanId, kind: "POINT_CLOUD", storageKey: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!pcAsset?.storageKey) throw new ValidationError("Scan has no processed point cloud");

  const job = await db.processingJob.create({
    data: {
      projectId: scan.projectId,
      scanId,
      type: "surface.build",
      executor: "inline",
      status: "RUNNING",
      attempts: 1,
      startedAt: new Date(),
      engine: `dem-grid-${opts.aggregation}`,
      engineVersion: GEOMETRY_ENGINE_VERSION,
      input: { ...opts, pointCloudAssetId: pcAsset.id },
    },
  });
  const log = logger.child({ op: "surface.build", scanId, jobId: job.id });
  try {
    const bytes = await storage.get(pcAsset.storageKey);
    const decoded = decodePointBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const positions = new Float64Array(decoded.count * 3);
    for (let i = 0; i < decoded.count * 3; i += 3) {
      positions[i] = decoded.positions[i]! + decoded.origin.x;
      positions[i + 1] = decoded.positions[i + 1]! + decoded.origin.y;
      positions[i + 2] = decoded.positions[i + 2]! + decoded.origin.z;
    }
    const cloud: PointCloud = { positions, count: decoded.count };
    let built;
    try {
      built = buildGridFromPointCloud(cloud, {
        cellSize: opts.cellSize,
        aggregation: opts.aggregation,
        maxCells: serverEnv().SURFACE_MAX_CELLS,
      });
    } catch (err) {
      throw new AppError("surface_error", err instanceof Error ? err.message : String(err), 422);
    }
    const summary = summarizeGrid(built.grid);
    const assetId = randomUUID();
    const key = `projects/${scan.projectId}/scans/${scanId}/assets/${assetId}.mfdm`;
    await storage.put(key, new Uint8Array(encodeGrid(built.grid)), "application/octet-stream");
    await db.asset.create({
      data: {
        id: assetId,
        projectId: scan.projectId,
        scanId,
        kind: "SURFACE",
        name: opts.name || `${scan.name} – DEM ${opts.cellSize} ${pcAsset.units}`,
        originalFilename: pcAsset.originalFilename,
        source: pcAsset.source,
        acquisitionDate: pcAsset.acquisitionDate,
        crs: pcAsset.crs,
        verticalDatum: pcAsset.verticalDatum,
        units: pcAsset.units,
        processingMethod: `dem-grid-${opts.aggregation}`,
        processingVersion: GEOMETRY_ENGINE_VERSION,
        parentAssetId: pcAsset.id,
        storageKey: key,
        surface: {
          create: {
            surfaceType: "GRID",
            resolution: opts.cellSize,
            cols: built.grid.cols,
            rows: built.grid.rows,
            originX: built.grid.originX,
            originY: built.grid.originY,
            zMin: summary.zMin,
            zMax: summary.zMax,
            aggregation: opts.aggregation,
            validCells: built.validCells,
            filledCells: built.filledCells,
          },
        },
      },
    });
    await db.processingJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        progress: 1,
        finishedAt: new Date(),
        output: { assetId, cols: built.grid.cols, rows: built.grid.rows, validCells: built.validCells, filledCells: built.filledCells, emptyCells: built.emptyCells },
      },
    });
    log.info("surface built", { assetId, cells: built.grid.cols * built.grid.rows });
    return (await data.getSurface(scan.projectId, assetId))!;
  } catch (err) {
    await db.processingJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
    });
    throw err;
  }
}

export async function listSurfaces(user: CurrentUser, projectId: string) {
  await requireProject(user, projectId);
  return services().data.listSurfaces(projectId);
}

async function surfaceAsset(user: CurrentUser, surfaceId: string) {
  const asset = await services().db.asset.findFirst({ where: { id: surfaceId, kind: "SURFACE" } });
  if (!asset) throw new NotFoundError("Surface", surfaceId);
  await requireProject(user, asset.projectId);
  return asset;
}

export async function getSurfaceGridBytes(user: CurrentUser, surfaceId: string): Promise<Uint8Array> {
  const asset = await surfaceAsset(user, surfaceId);
  if (!asset.storageKey) throw new NotFoundError("Surface grid", surfaceId);
  return services().storage.get(asset.storageKey);
}

export async function deleteSurface(user: CurrentUser, surfaceId: string) {
  const asset = await surfaceAsset(user, surfaceId);
  await services().db.asset.delete({ where: { id: surfaceId } });
  if (asset.storageKey) await services().storage.delete(asset.storageKey).catch(() => undefined);
}

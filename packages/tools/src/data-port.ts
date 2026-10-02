import type { BoundingBox, Vec3 } from "@massefelt/shared";
import type { PointCloudStatistics } from "@massefelt/geometry";

/** Read model the tools need. Implemented by the web app (Prisma) and by in-memory fakes in tests. */
export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  defaultCrs: string | null;
  defaultVerticalDatum: string | null;
  units: string;
  createdAt: string;
  scanCount: number;
  measurementCount: number;
}

export interface ScanSummary {
  id: string;
  name: string;
  status: string;
  source: string;
  acquisitionDate: string | null;
  crs: string | null;
  verticalDatum: string | null;
  units: string;
  pointCount: number | null;
  originalFilename: string | null;
  createdAt: string;
}

export interface PointCloudAssetInfo {
  assetId: string;
  pointCount: number;
  bbox: BoundingBox;
  origin: Vec3;
  hasColor: boolean;
  hasIntensity: boolean;
  statistics: PointCloudStatistics;
  provenance: {
    originalFilename: string;
    source: string;
    acquisitionDate: string | null;
    crs: string | null;
    verticalDatum: string | null;
    processingMethod: string;
    processingVersion: string;
    units: string;
    parentAssetId: string | null;
    createdAt: string;
  };
}

export interface ScanDetail extends ScanSummary {
  statusMessage: string | null;
  files: { id: string; originalFilename: string; format: string; sizeBytes: number; sha256: string }[];
  pointCloud: PointCloudAssetInfo | null;
}

export interface MeasurementRecord {
  id: string;
  name: string;
  type: string;
  scanId: string | null;
  points: Vec3[];
  value: number;
  result: Record<string, unknown>;
  crs: string | null;
  units: string;
  engineVersion: string;
  createdAt: string;
}

export interface ProjectDataPort {
  getProject(projectId: string): Promise<ProjectSummary | null>;
  listScans(projectId: string): Promise<ScanSummary[]>;
  getScan(projectId: string, scanId: string): Promise<ScanDetail | null>;
  listMeasurements(projectId: string, filter?: { scanId?: string }): Promise<MeasurementRecord[]>;
  getMeasurement(projectId: string, measurementId: string): Promise<MeasurementRecord | null>;
}

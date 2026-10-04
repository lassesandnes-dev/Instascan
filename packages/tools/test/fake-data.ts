import { buildGridFromPointCloud, type DemGrid } from "@massefelt/geometry";
import type { MeasurementRecord, ProjectDataPort, ScanDetail, SurfaceSummary, VolumeRecord } from "../src";

export const PROJECT_ID = "proj_1";
export const SCAN: ScanDetail = {
  id: "scan_1",
  name: "Byggegrop nord",
  status: "READY",
  source: "file-import",
  acquisitionDate: null,
  crs: "EPSG:25832",
  verticalDatum: "NN2000",
  units: "m",
  pointCount: 4,
  originalFilename: "grop.xyz",
  createdAt: "2026-10-01T00:00:00.000Z",
  statusMessage: null,
  files: [{ id: "f1", originalFilename: "grop.xyz", format: "xyz", sizeBytes: 100, sha256: "abc" }],
  pointCloud: {
    assetId: "asset_1",
    pointCount: 4,
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 6 } },
    origin: { x: 5, y: 5, z: 0 },
    hasColor: false,
    hasIntensity: false,
    statistics: {
      count: 4,
      bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 6 } },
      extent: { x: 10, y: 10, z: 6 },
      centroid: { x: 5, y: 5, z: 3 },
      z: { min: 0, max: 6, mean: 3, stdDev: 2.58 },
      planarDensity: 0.04,
      hasColor: false,
      hasIntensity: false,
    },
    provenance: {
      originalFilename: "grop.xyz",
      source: "file-import",
      acquisitionDate: null,
      crs: "EPSG:25832",
      verticalDatum: "NN2000",
      processingMethod: "xyz-import",
      processingVersion: "0.1.0",
      units: "m",
      parentAssetId: null,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  },
};
export const MEASUREMENT: MeasurementRecord = {
  id: "meas_1",
  name: "Distance 1",
  type: "DISTANCE",
  scanId: "scan_1",
  points: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 }],
  value: 13,
  result: { distance3d: 13, horizontalDistance: 5, dx: 3, dy: 4, dz: 12 },
  crs: "EPSG:25832",
  units: "m",
  engineVersion: "0.1.0",
  createdAt: "2026-10-01T00:00:00.000Z",
};

/** 20×20 m flat ground at z=10 ("before") and the same with a 10×10×2 m box pile ("after"). */
function grid(fn: (x: number, y: number) => number): DemGrid {
  const pts: number[] = [];
  for (let x = 0.125; x < 20; x += 0.25) for (let y = 0.125; y < 20; y += 0.25) pts.push(x, y, fn(x, y));
  return buildGridFromPointCloud({ positions: Float64Array.from(pts), count: pts.length / 3 }, { cellSize: 0.5 }).grid;
}
const GRIDS: Record<string, DemGrid> = {
  surf_before: grid(() => 10),
  surf_after: grid((x, y) => (x > 5 && x < 15 && y > 5 && y < 15 ? 12 : 10)),
  surf_other_crs: grid(() => 10),
};
function surface(id: string, name: string, crs = "EPSG:25832"): SurfaceSummary {
  return {
    id, name, scanId: "scan_1", surfaceType: "GRID", cellSize: 0.5, cols: 40, rows: 40, aggregation: "mean",
    zMin: 10, zMax: 12, validCells: 1600, filledCells: 0, crs, verticalDatum: "NN2000", units: "m",
    processingMethod: "dem-grid-mean", processingVersion: "0.2.0", parentAssetId: "asset_1", createdAt: "2026-10-01T00:00:00.000Z",
  };
}
export const SURFACES = [surface("surf_before", "Before"), surface("surf_after", "After"), surface("surf_other_crs", "Other", "EPSG:5972")];
export const VOLUME: VolumeRecord = {
  id: "vol_1", name: "Pile", method: "elevation", topSurfaceId: "surf_after", baseSurfaceId: null, referenceElevation: 10,
  boundary: [{ x: 4, y: 4 }, { x: 16, y: 4 }, { x: 16, y: 16 }, { x: 4, y: 16 }], area: 144,
  volumeAbove: 200, volumeBelow: 0, net: 200, result: {}, crs: "EPSG:25832", units: "m", engineVersion: "0.2.0",
  createdAt: "2026-10-01T00:00:00.000Z",
};

export function createFakeData(): ProjectDataPort {
  return {
    async getProject(projectId) {
      if (projectId !== PROJECT_ID) return null;
      return {
        id: PROJECT_ID,
        name: "Testprosjekt",
        description: null,
        defaultCrs: "EPSG:25832",
        defaultVerticalDatum: "NN2000",
        units: "m",
        createdAt: "2026-10-01T00:00:00.000Z",
        scanCount: 1,
        measurementCount: 1,
      };
    },
    async listScans(projectId) {
      if (projectId !== PROJECT_ID) return [];
      const { files: _f, pointCloud: _p, statusMessage: _s, ...summary } = SCAN;
      return [summary];
    },
    async getScan(projectId, scanId) {
      return projectId === PROJECT_ID && scanId === SCAN.id ? SCAN : null;
    },
    async listMeasurements(projectId) {
      return projectId === PROJECT_ID ? [MEASUREMENT] : [];
    },
    async getMeasurement(projectId, id) {
      return projectId === PROJECT_ID && id === MEASUREMENT.id ? MEASUREMENT : null;
    },
    async listSurfaces(projectId) {
      return projectId === PROJECT_ID ? SURFACES : [];
    },
    async getSurface(projectId, id) {
      return projectId === PROJECT_ID ? (SURFACES.find((s) => s.id === id) ?? null) : null;
    },
    async loadSurfaceGrid(projectId, id) {
      return projectId === PROJECT_ID ? (GRIDS[id] ?? null) : null;
    },
    async listVolumes(projectId) {
      return projectId === PROJECT_ID ? [VOLUME] : [];
    },
    async getVolume(projectId, id) {
      return projectId === PROJECT_ID && id === VOLUME.id ? VOLUME : null;
    },
    async listCrossSections() {
      return [];
    },
    async getCrossSection() {
      return null;
    },
  };
}

import type { BoundingBox, Vec3 } from "@massefelt/shared";
import type { PointCloud } from "./pointcloud";

export interface PointCloudStatistics {
  count: number;
  bbox: BoundingBox;
  extent: Vec3;
  centroid: Vec3;
  z: { min: number; max: number; mean: number; stdDev: number };
  /** Approximate planimetric (XY) density: points per square unit of bbox footprint. */
  planarDensity: number | null;
  hasColor: boolean;
  hasIntensity: boolean;
}

export function computeBoundingBox(cloud: PointCloud): BoundingBox {
  if (cloud.count === 0) throw new Error("Cannot compute bounding box of an empty point cloud");
  const p = cloud.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < cloud.count * 3; i += 3) {
    const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/** Deterministic summary statistics. Uses Welford's algorithm for numerical stability. */
export function computeStatistics(cloud: PointCloud): PointCloudStatistics {
  const bbox = computeBoundingBox(cloud);
  const p = cloud.positions;
  let mx = 0, my = 0, mz = 0, m2z = 0;
  for (let k = 0; k < cloud.count; k++) {
    const i = k * 3;
    const n = k + 1;
    mx += (p[i]! - mx) / n;
    my += (p[i + 1]! - my) / n;
    const dz = p[i + 2]! - mz;
    mz += dz / n;
    m2z += dz * (p[i + 2]! - mz);
  }
  const extent = {
    x: bbox.max.x - bbox.min.x,
    y: bbox.max.y - bbox.min.y,
    z: bbox.max.z - bbox.min.z,
  };
  const area = extent.x * extent.y;
  return {
    count: cloud.count,
    bbox,
    extent,
    centroid: { x: mx, y: my, z: mz },
    z: { min: bbox.min.z, max: bbox.max.z, mean: mz, stdDev: cloud.count > 1 ? Math.sqrt(m2z / (cloud.count - 1)) : 0 },
    planarDensity: area > 0 ? cloud.count / area : null,
    hasColor: cloud.colors !== undefined,
    hasIntensity: cloud.intensity !== undefined,
  };
}

import type { Vec3 } from "@massefelt/shared";

/**
 * In-memory point cloud.
 *
 * Coordinates are kept in Float64 so projected coordinates such as UTM
 * (e.g. N = 6 650 000 m) keep millimetre precision. Float32 conversion only
 * happens in the web-optimized encoding, relative to a local origin.
 */
export interface PointCloud {
  /** Interleaved x,y,z in world coordinates. length = count * 3 */
  positions: Float64Array;
  /** Optional interleaved r,g,b in 0..255. length = count * 3 */
  colors?: Uint8Array;
  /** Optional per-point intensity. */
  intensity?: Float32Array;
  count: number;
}

export function getPoint(cloud: PointCloud, index: number): Vec3 {
  if (index < 0 || index >= cloud.count) throw new RangeError(`Point index ${index} out of range`);
  const i = index * 3;
  return { x: cloud.positions[i]!, y: cloud.positions[i + 1]!, z: cloud.positions[i + 2]! };
}

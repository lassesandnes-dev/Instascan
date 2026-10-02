import type { Vec3 } from "@massefelt/shared";
import type { PointCloud } from "./pointcloud";
import { computeBoundingBox } from "./stats";

/**
 * Web-optimized point buffer ("MFPC" v1).
 *
 * Layout (little endian):
 *   0   4 bytes  magic "MFPC"
 *   4   u32      version (1)
 *   8   u32      point count N
 *   12  u32      flags (bit0 = has colour)
 *   16  f64 x3   local origin (world coordinates)
 *   40  f32 x3N  positions relative to origin
 *   ..  u8  x3N  colours (only if flag bit0), padded to 4 bytes
 *
 * Positions are stored relative to a local origin so that large projected
 * coordinates survive the Float32 conversion GPUs require. Clients add the
 * origin back (in Float64) to recover world coordinates.
 */
export const MFPC_MAGIC = 0x4350464d; // "MFPC" little endian
export const MFPC_VERSION = 1;
const HEADER_BYTES = 40;

export interface EncodedPointCloud {
  buffer: ArrayBuffer;
  origin: Vec3;
}

export interface DecodedPointBuffer {
  count: number;
  origin: Vec3;
  /** Positions relative to origin. */
  positions: Float32Array;
  colors: Uint8Array | null;
}

/** Choose a stable local origin: XY bbox centre and Z minimum, floored to whole units. */
export function chooseLocalOrigin(cloud: PointCloud): Vec3 {
  const { min, max } = computeBoundingBox(cloud);
  return {
    x: Math.floor((min.x + max.x) / 2),
    y: Math.floor((min.y + max.y) / 2),
    z: Math.floor(min.z),
  };
}

export function encodePointCloud(cloud: PointCloud, origin: Vec3 = chooseLocalOrigin(cloud)): EncodedPointCloud {
  const n = cloud.count;
  const hasColor = cloud.colors !== undefined && cloud.colors.length === n * 3;
  const colorBytes = hasColor ? Math.ceil((n * 3) / 4) * 4 : 0;
  const buffer = new ArrayBuffer(HEADER_BYTES + n * 12 + colorBytes);
  const view = new DataView(buffer);
  view.setUint32(0, MFPC_MAGIC, true);
  view.setUint32(4, MFPC_VERSION, true);
  view.setUint32(8, n, true);
  view.setUint32(12, hasColor ? 1 : 0, true);
  view.setFloat64(16, origin.x, true);
  view.setFloat64(24, origin.y, true);
  view.setFloat64(32, origin.z, true);
  const pos = new Float32Array(buffer, HEADER_BYTES, n * 3);
  for (let i = 0; i < n * 3; i += 3) {
    pos[i] = cloud.positions[i]! - origin.x;
    pos[i + 1] = cloud.positions[i + 1]! - origin.y;
    pos[i + 2] = cloud.positions[i + 2]! - origin.z;
  }
  if (hasColor) new Uint8Array(buffer, HEADER_BYTES + n * 12, n * 3).set(cloud.colors!);
  return { buffer, origin };
}

export function decodePointBuffer(buffer: ArrayBuffer): DecodedPointBuffer {
  if (buffer.byteLength < HEADER_BYTES) throw new Error("Point buffer too small");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MFPC_MAGIC) throw new Error("Not an MFPC point buffer");
  const version = view.getUint32(4, true);
  if (version !== MFPC_VERSION) throw new Error(`Unsupported MFPC version ${version}`);
  const count = view.getUint32(8, true);
  const hasColor = (view.getUint32(12, true) & 1) === 1;
  const expected = HEADER_BYTES + count * 12 + (hasColor ? Math.ceil((count * 3) / 4) * 4 : 0);
  if (buffer.byteLength < expected) throw new Error("Point buffer truncated");
  return {
    count,
    origin: { x: view.getFloat64(16, true), y: view.getFloat64(24, true), z: view.getFloat64(32, true) },
    positions: new Float32Array(buffer, HEADER_BYTES, count * 3),
    colors: hasColor ? new Uint8Array(buffer, HEADER_BYTES + count * 12, count * 3) : null,
  };
}

/** Convert a local (origin-relative) position back to world coordinates in Float64. */
export function toWorld(local: Vec3, origin: Vec3): Vec3 {
  return { x: local.x + origin.x, y: local.y + origin.y, z: local.z + origin.z };
}

export function toLocal(world: Vec3, origin: Vec3): Vec3 {
  return { x: world.x - origin.x, y: world.y - origin.y, z: world.z - origin.z };
}

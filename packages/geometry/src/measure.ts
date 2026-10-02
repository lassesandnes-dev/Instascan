import type { Vec3 } from "@massefelt/shared";

export interface DistanceResult {
  /** True 3D (slope) distance. */
  distance3d: number;
  /** Horizontal (XY plane) distance. */
  horizontalDistance: number;
  /** Signed component differences, end − start. */
  dx: number;
  dy: number;
  dz: number;
  /** Slope in percent (dz / horizontal × 100); null for a vertical segment. */
  slopePercent: number | null;
  /** Slope angle from horizontal in degrees. */
  slopeDegrees: number;
}

export function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * Distance between two points in the same coordinate system.
 * Both points must be expressed in the same CRS and units; this function does
 * not (and must not) convert coordinates.
 */
export function measureDistance(a: Vec3, b: Vec3): DistanceResult {
  if (!isFiniteVec3(a) || !isFiniteVec3(b)) throw new RangeError("Coordinates must be finite numbers");
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const horizontalDistance = Math.hypot(dx, dy);
  const distance3d = Math.hypot(dx, dy, dz);
  return {
    distance3d,
    horizontalDistance,
    dx,
    dy,
    dz,
    slopePercent: horizontalDistance > 0 ? (dz / horizontalDistance) * 100 : null,
    slopeDegrees: distance3d > 0 ? (Math.atan2(dz, horizontalDistance) * 180) / Math.PI : 0,
  };
}

/** Height difference b.z − a.z (positive when b is higher). */
export function measureElevationDifference(a: Vec3, b: Vec3): number {
  if (!isFiniteVec3(a) || !isFiniteVec3(b)) throw new RangeError("Coordinates must be finite numbers");
  return b.z - a.z;
}

/** A point / vector in a project's native (world) coordinate system. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned bounding box in world coordinates. */
export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

/** Linear units supported for geometry. Metres is the canonical engine unit. */
export type LinearUnit = "m" | "mm" | "cm" | "ft" | "us-ft";

export const LINEAR_UNITS: readonly LinearUnit[] = ["m", "mm", "cm", "ft", "us-ft"] as const;

/** Rotation in radians around X, Y and Z (applied XYZ, intrinsic). */
export type EulerXYZ = Vec3;

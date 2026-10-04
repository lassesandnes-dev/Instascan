import { cellCenter, elevationAt, type DemGrid } from "./grid";
import { densifyRing, pointInPolygon, polygonArea, polygonBounds, validatePolygon, type XY } from "./polygon";

/** Reference the measured surface is compared against. */
export type VolumeReference =
  /** Horizontal plane at a fixed elevation (e.g. design level / formation level). */
  | { type: "elevation"; z: number }
  /** Horizontal plane through the lowest surface elevation found along the boundary (stockpile). */
  | { type: "lowest-boundary" }
  /** Least-squares plane through surface elevations sampled along the boundary (stockpile on a slope). */
  | { type: "boundary-plane" }
  /** Another surface (e.g. original terrain before excavation). */
  | { type: "surface"; grid: DemGrid };

export interface FittedPlane {
  /** z = z0 + slopeX·(x − x0) + slopeY·(y − y0) */
  x0: number;
  y0: number;
  z0: number;
  slopeX: number;
  slopeY: number;
  /** RMS of boundary samples about the plane; large values mean the boundary is not planar. */
  rmsResidual: number;
  sampleCount: number;
}

export interface VolumeResult {
  /** Material above the reference (cut when the reference is a design level; stockpile volume). */
  volumeAbove: number;
  /** Void below the reference (fill when the reference is a design level; excavation volume). */
  volumeBelow: number;
  /** volumeAbove − volumeBelow */
  net: number;
  /** Planimetric area of the boundary. */
  area: number;
  /** Area where both surface and reference had data. */
  analyzedArea: number;
  /** Area inside the boundary without data (excluded from the volumes). */
  voidArea: number;
  voidFraction: number;
  cellSize: number;
  surfaceZ: { min: number | null; max: number | null };
  reference:
    | { type: "elevation"; z: number }
    | { type: "lowest-boundary"; z: number }
    | { type: "boundary-plane"; plane: FittedPlane }
    | { type: "surface" };
  method: "grid-prism";
  warnings: string[];
}

export class VolumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VolumeError";
  }
}

const SUBSAMPLES = 8;

/** Sample surface elevations along a (closed) boundary every `step` units; NaNs dropped. */
export function sampleBoundary(grid: DemGrid, ring: readonly XY[], step = grid.cellSize): { x: number; y: number; z: number }[] {
  return densifyRing(ring, step)
    .map((p) => ({ ...p, z: elevationAt(grid, p.x, p.y) }))
    .filter((p) => !Number.isNaN(p.z));
}

/** Least-squares plane z = z0 + a(x−x0) + b(y−y0). Throws if samples are degenerate (collinear). */
export function fitPlane(samples: readonly { x: number; y: number; z: number }[]): FittedPlane {
  const n = samples.length;
  if (n < 3) throw new VolumeError("Need at least 3 boundary samples with data to fit a plane");
  let x0 = 0, y0 = 0, z0 = 0;
  for (const s of samples) {
    x0 += s.x / n;
    y0 += s.y / n;
    z0 += s.z / n;
  }
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const s of samples) {
    const dx = s.x - x0, dy = s.y - y0, dz = s.z - z0;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
    sxz += dx * dz;
    syz += dy * dz;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-12 * Math.max(1, sxx * syy)) throw new VolumeError("Boundary samples are collinear; cannot fit a plane");
  const slopeX = (sxz * syy - syz * sxy) / det;
  const slopeY = (syz * sxx - sxz * sxy) / det;
  let ss = 0;
  for (const s of samples) {
    const r = s.z - (z0 + slopeX * (s.x - x0) + slopeY * (s.y - y0));
    ss += r * r;
  }
  return { x0, y0, z0, slopeX, slopeY, rmsResidual: Math.sqrt(ss / n), sampleCount: n };
}

function evalPlane(p: FittedPlane, x: number, y: number): number {
  return p.z0 + p.slopeX * (x - p.x0) + p.slopeY * (y - p.y0);
}

/** Mark grid cells crossed by the boundary edges (these get sub-sampled for partial coverage). */
function boundaryCells(grid: DemGrid, ring: readonly XY[]): Set<number> {
  const set = new Set<number>();
  const step = grid.cellSize / 4;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
      const col = Math.floor((x - grid.originX) / grid.cellSize);
      const row = Math.floor((y - grid.originY) / grid.cellSize);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) set.add((row + dr) * 1_000_003 + (col + dc));
    }
  }
  return set;
}

/**
 * Volume between a measured surface (grid) and a reference, inside a
 * boundary polygon, by the grid-prism method: each cell contributes
 * (surface − reference) × covered cell area. Cells cut by the boundary use
 * 8×8 sub-sampling for their covered fraction. Accuracy is governed by the
 * cell size; results are deterministic.
 *
 * @param boundary closed ring in the grid's CRS; omit to use the whole grid extent.
 */
export function computeVolume(grid: DemGrid, reference: VolumeReference, boundary?: readonly XY[]): VolumeResult {
  const ring: XY[] = boundary
    ? [...boundary]
    : [
        { x: grid.originX, y: grid.originY },
        { x: grid.originX + grid.cols * grid.cellSize, y: grid.originY },
        { x: grid.originX + grid.cols * grid.cellSize, y: grid.originY + grid.rows * grid.cellSize },
        { x: grid.originX, y: grid.originY + grid.rows * grid.cellSize },
      ];
  const invalid = validatePolygon(ring);
  if (invalid) throw new VolumeError(invalid);
  const warnings: string[] = [];

  let refFn: (x: number, y: number) => number;
  let refOut: VolumeResult["reference"];
  switch (reference.type) {
    case "elevation":
      if (!Number.isFinite(reference.z)) throw new VolumeError("Reference elevation must be finite");
      refFn = () => reference.z;
      refOut = { type: "elevation", z: reference.z };
      break;
    case "lowest-boundary": {
      const samples = sampleBoundary(grid, ring);
      if (!samples.length) throw new VolumeError("The surface has no data along the boundary");
      const z = Math.min(...samples.map((s) => s.z));
      refFn = () => z;
      refOut = { type: "lowest-boundary", z };
      break;
    }
    case "boundary-plane": {
      const plane = fitPlane(sampleBoundary(grid, ring));
      if (plane.rmsResidual > 0.25) {
        warnings.push(`Boundary is not planar (RMS ${plane.rmsResidual.toFixed(3)} about the fitted base plane); check the base definition`);
      }
      refFn = (x, y) => evalPlane(plane, x, y);
      refOut = { type: "boundary-plane", plane };
      break;
    }
    case "surface": {
      const other = reference.grid;
      refFn = (x, y) => elevationAt(other, x, y);
      refOut = { type: "surface" };
      break;
    }
  }

  const { minX, minY, maxX, maxY } = polygonBounds(ring);
  const cs = grid.cellSize;
  const cellArea = cs * cs;
  const c0 = Math.max(0, Math.floor((minX - grid.originX) / cs));
  const c1 = Math.min(grid.cols - 1, Math.floor((maxX - grid.originX) / cs));
  const r0 = Math.max(0, Math.floor((minY - grid.originY) / cs));
  const r1 = Math.min(grid.rows - 1, Math.floor((maxY - grid.originY) / cs));
  const edges = boundaryCells(grid, ring);

  let above = 0, below = 0, analyzed = 0, voidArea = 0;
  let zMin = Infinity, zMax = -Infinity;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      let frac: number;
      if (edges.has(row * 1_000_003 + col)) {
        let inside = 0;
        for (let i = 0; i < SUBSAMPLES; i++) {
          for (let j = 0; j < SUBSAMPLES; j++) {
            const p = { x: grid.originX + (col + (i + 0.5) / SUBSAMPLES) * cs, y: grid.originY + (row + (j + 0.5) / SUBSAMPLES) * cs };
            if (pointInPolygon(p, ring)) inside++;
          }
        }
        frac = inside / (SUBSAMPLES * SUBSAMPLES);
      } else {
        frac = pointInPolygon(cellCenter(grid, col, row), ring) ? 1 : 0;
      }
      if (frac === 0) continue;
      const a = frac * cellArea;
      const z = grid.z[row * grid.cols + col]!;
      const c = cellCenter(grid, col, row);
      const zr = refFn(c.x, c.y);
      if (Number.isNaN(z) || Number.isNaN(zr)) {
        voidArea += a;
        continue;
      }
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      analyzed += a;
      const dz = z - zr;
      if (dz > 0) above += dz * a;
      else below -= dz * a;
    }
  }

  const area = polygonArea(ring);
  // Area of the boundary outside the grid extent counts as void.
  const gridCovered = analyzed + voidArea;
  if (area - gridCovered > cellArea * 0.5) voidArea += area - gridCovered;
  const voidFraction = area > 0 ? voidArea / area : 0;
  if (voidFraction > 0.05) {
    warnings.push(`${(voidFraction * 100).toFixed(1)} % of the area has no surface data and is excluded from the volumes`);
  }
  if (analyzed === 0) throw new VolumeError("No surface data inside the boundary");
  return {
    volumeAbove: above,
    volumeBelow: below,
    net: above - below,
    area,
    analyzedArea: analyzed,
    voidArea,
    voidFraction,
    cellSize: cs,
    surfaceZ: { min: Number.isFinite(zMin) ? zMin : null, max: Number.isFinite(zMax) ? zMax : null },
    reference: refOut,
    method: "grid-prism",
    warnings,
  };
}

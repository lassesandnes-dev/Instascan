import type { PointCloud } from "./pointcloud";
import type { XY } from "./polygon";

/**
 * Regular elevation grid (DEM / raster surface).
 *
 * Cell (col,row) covers [originX + col·cellSize, originX + (col+1)·cellSize) ×
 * [originY + row·cellSize, …); its elevation represents the cell centre.
 * Empty cells are NaN. Row 0 is the southern-most row (Y increases with row).
 */
export interface DemGrid {
  originX: number;
  originY: number;
  cellSize: number;
  cols: number;
  rows: number;
  /** length = cols·rows, index = row·cols + col */
  z: Float64Array;
}

export type GridAggregation = "mean" | "min" | "max";

export interface BuildGridOptions {
  cellSize: number;
  /** "min" approximates bare ground under vegetation/noise; "mean" suits clean terrain. */
  aggregation?: GridAggregation;
  /** Passes of hole filling (cells with ≥ 4 of 8 valid neighbours get their mean). 0 disables. */
  fillPasses?: number;
  maxCells?: number;
}

export interface BuildGridResult {
  grid: DemGrid;
  validCells: number;
  filledCells: number;
  emptyCells: number;
}

export const DEFAULT_MAX_GRID_CELLS = 25_000_000;

export function gridIndex(grid: DemGrid, col: number, row: number): number {
  return row * grid.cols + col;
}

export function cellCenter(grid: DemGrid, col: number, row: number): XY {
  return { x: grid.originX + (col + 0.5) * grid.cellSize, y: grid.originY + (row + 0.5) * grid.cellSize };
}

/** Rasterise a point cloud into a DEM grid. Deterministic for a given input and options. */
export function buildGridFromPointCloud(cloud: PointCloud, options: BuildGridOptions): BuildGridResult {
  const cs = options.cellSize;
  if (!(cs > 0) || !Number.isFinite(cs)) throw new RangeError("cellSize must be a positive number");
  if (cloud.count === 0) throw new RangeError("Point cloud is empty");
  const aggregation = options.aggregation ?? "mean";
  const p = cloud.positions;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < cloud.count * 3; i += 3) {
    if (p[i]! < minX) minX = p[i]!;
    if (p[i]! > maxX) maxX = p[i]!;
    if (p[i + 1]! < minY) minY = p[i + 1]!;
    if (p[i + 1]! > maxY) maxY = p[i + 1]!;
  }
  // Align the grid to multiples of the cell size so grids of the same resolution share cell boundaries.
  const originX = Math.floor(minX / cs) * cs;
  const originY = Math.floor(minY / cs) * cs;
  const cols = Math.max(1, Math.floor((maxX - originX) / cs) + 1);
  const rows = Math.max(1, Math.floor((maxY - originY) / cs) + 1);
  const maxCells = options.maxCells ?? DEFAULT_MAX_GRID_CELLS;
  if (cols * rows > maxCells) {
    throw new RangeError(`Grid would have ${cols * rows} cells (max ${maxCells}); use a larger cell size`);
  }
  const n = cols * rows;
  const acc = new Float64Array(n);
  const count = new Uint32Array(n);
  if (aggregation === "min") acc.fill(Infinity);
  if (aggregation === "max") acc.fill(-Infinity);
  for (let i = 0; i < cloud.count * 3; i += 3) {
    const col = Math.min(cols - 1, Math.floor((p[i]! - originX) / cs));
    const row = Math.min(rows - 1, Math.floor((p[i + 1]! - originY) / cs));
    const k = row * cols + col;
    const z = p[i + 2]!;
    if (aggregation === "mean") acc[k]! += z;
    else if (aggregation === "min") acc[k] = Math.min(acc[k]!, z);
    else acc[k] = Math.max(acc[k]!, z);
    count[k]!++;
  }
  const z = new Float64Array(n);
  let validCells = 0;
  for (let k = 0; k < n; k++) {
    if (count[k] === 0) z[k] = NaN;
    else {
      z[k] = aggregation === "mean" ? acc[k]! / count[k]! : acc[k]!;
      validCells++;
    }
  }
  const grid: DemGrid = { originX, originY, cellSize: cs, cols, rows, z };
  const filledCells = fillHoles(grid, options.fillPasses ?? 2);
  return { grid, validCells, filledCells, emptyCells: n - validCells - filledCells };
}

/** Fill small gaps: a NaN cell with ≥ 4 valid 8-neighbours gets their mean. Never extrapolates far. */
export function fillHoles(grid: DemGrid, passes: number): number {
  let filled = 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = Float64Array.from(grid.z);
    let changed = 0;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const k = row * grid.cols + col;
        if (!Number.isNaN(grid.z[k]!)) continue;
        let sum = 0, cnt = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const r = row + dr, c = col + dc;
            if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
            const v = grid.z[r * grid.cols + c]!;
            if (!Number.isNaN(v)) {
              sum += v;
              cnt++;
            }
          }
        }
        if (cnt >= 4) {
          next[k] = sum / cnt;
          changed++;
        }
      }
    }
    grid.z.set(next);
    filled += changed;
    if (!changed) break;
  }
  return filled;
}

/**
 * Bilinear elevation between cell centres. Returns NaN outside the grid or
 * where the surrounding cells have no data (nearest valid neighbour is used
 * when only some of the four are missing).
 */
export function elevationAt(grid: DemGrid, x: number, y: number): number {
  const fx = (x - grid.originX) / grid.cellSize - 0.5;
  const fy = (y - grid.originY) / grid.cellSize - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > grid.cols - 0.5 || fy > grid.rows - 0.5) return NaN;
  const c0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(fy)));
  const c1 = Math.min(grid.cols - 1, c0 + 1);
  const r1 = Math.min(grid.rows - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, fx - c0));
  const ty = Math.max(0, Math.min(1, fy - r0));
  const corners: [number, number][] = [
    [grid.z[r0 * grid.cols + c0]!, (1 - tx) * (1 - ty)],
    [grid.z[r0 * grid.cols + c1]!, tx * (1 - ty)],
    [grid.z[r1 * grid.cols + c0]!, (1 - tx) * ty],
    [grid.z[r1 * grid.cols + c1]!, tx * ty],
  ];
  let sum = 0, w = 0;
  for (const [v, wt] of corners) {
    if (!Number.isNaN(v)) {
      sum += v * wt;
      w += wt;
    }
  }
  if (w === 0) return NaN;
  return sum / w;
}

export interface GridSummary {
  cols: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  validCells: number;
  emptyCells: number;
  zMin: number | null;
  zMax: number | null;
  zMean: number | null;
  /** Planimetric area covered by cells with data. */
  coveredArea: number;
}

export function summarizeGrid(grid: DemGrid): GridSummary {
  let valid = 0, min = Infinity, max = -Infinity, mean = 0;
  for (const v of grid.z) {
    if (Number.isNaN(v)) continue;
    valid++;
    mean += (v - mean) / valid;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    cols: grid.cols,
    rows: grid.rows,
    cellSize: grid.cellSize,
    originX: grid.originX,
    originY: grid.originY,
    validCells: valid,
    emptyCells: grid.cols * grid.rows - valid,
    zMin: valid ? min : null,
    zMax: valid ? max : null,
    zMean: valid ? mean : null,
    coveredArea: valid * grid.cellSize * grid.cellSize,
  };
}

// ───────────── binary encoding ("MFDM" v1) ─────────────
//   0  "MFDM" u32, 4 version u32, 8 cols u32, 12 rows u32,
//   16 cellSize f64, 24 originX f64, 32 originY f64, 40 zOrigin f64,
//   48 f32 × cols·rows   (z − zOrigin, NaN = no data)
export const MFDM_MAGIC = 0x4d44464d; // "MFDM" little endian
const DEM_HEADER = 48;

export function encodeGrid(grid: DemGrid): ArrayBuffer {
  const n = grid.cols * grid.rows;
  let zOrigin = Infinity;
  for (const v of grid.z) if (!Number.isNaN(v) && v < zOrigin) zOrigin = v;
  if (!Number.isFinite(zOrigin)) zOrigin = 0;
  zOrigin = Math.floor(zOrigin);
  const buffer = new ArrayBuffer(DEM_HEADER + n * 4);
  const view = new DataView(buffer);
  view.setUint32(0, MFDM_MAGIC, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, grid.cols, true);
  view.setUint32(12, grid.rows, true);
  view.setFloat64(16, grid.cellSize, true);
  view.setFloat64(24, grid.originX, true);
  view.setFloat64(32, grid.originY, true);
  view.setFloat64(40, zOrigin, true);
  const out = new Float32Array(buffer, DEM_HEADER, n);
  for (let k = 0; k < n; k++) out[k] = grid.z[k]! - zOrigin;
  return buffer;
}

export function decodeGrid(buffer: ArrayBuffer): DemGrid {
  if (buffer.byteLength < DEM_HEADER) throw new Error("Grid buffer too small");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MFDM_MAGIC) throw new Error("Not an MFDM grid buffer");
  if (view.getUint32(4, true) !== 1) throw new Error("Unsupported MFDM version");
  const cols = view.getUint32(8, true);
  const rows = view.getUint32(12, true);
  if (buffer.byteLength < DEM_HEADER + cols * rows * 4) throw new Error("Grid buffer truncated");
  const zOrigin = view.getFloat64(40, true);
  const src = new Float32Array(buffer, DEM_HEADER, cols * rows);
  const z = new Float64Array(cols * rows);
  for (let k = 0; k < z.length; k++) z[k] = src[k]! + zOrigin;
  return {
    cols,
    rows,
    cellSize: view.getFloat64(16, true),
    originX: view.getFloat64(24, true),
    originY: view.getFloat64(32, true),
    z,
  };
}

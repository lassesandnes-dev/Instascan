import { describe, expect, it } from "vitest";
import {
  buildGridFromPointCloud,
  computeVolume,
  crossSection,
  decodeGrid,
  elevationAt,
  encodeGrid,
  fitPlane,
  pointInPolygon,
  polygonArea,
  summarizeGrid,
  thinProfile,
  validatePolygon,
  VolumeError,
  type PointCloud,
  type XY,
} from "../src";

/** Sample a height function on a regular lattice (spacing s) as a point cloud. */
function cloudFrom(fn: (x: number, y: number) => number, x0: number, y0: number, w: number, h: number, s: number): PointCloud {
  const pts: number[] = [];
  for (let x = x0 + s / 2; x < x0 + w; x += s) for (let y = y0 + s / 2; y < y0 + h; y += s) pts.push(x, y, fn(x, y));
  return { positions: Float64Array.from(pts), count: pts.length / 3 };
}

const square = (cx: number, cy: number, half: number): XY[] => [
  { x: cx - half, y: cy - half },
  { x: cx + half, y: cy - half },
  { x: cx + half, y: cy + half },
  { x: cx - half, y: cy + half },
];
const circle = (cx: number, cy: number, r: number, n = 72): XY[] =>
  Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));

describe("polygons", () => {
  it("computes area, inclusion and validity", () => {
    const sq = square(0, 0, 5);
    expect(polygonArea(sq)).toBe(100);
    expect(pointInPolygon({ x: 1, y: 1 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 6, y: 1 }, sq)).toBe(false);
    expect(validatePolygon(sq)).toBeNull();
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toMatch(/at least 3/);
    // bow-tie
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }])).toMatch(/cross/);
  });

  it("keeps precision for projected coordinates", () => {
    expect(polygonArea(square(598100, 6643200, 5))).toBeCloseTo(100, 6);
  });
});

describe("DEM grid", () => {
  it("rasterises with mean/min aggregation and aligned origin", () => {
    const cloud: PointCloud = { positions: Float64Array.from([0.1, 0.1, 1, 0.2, 0.2, 3, 1.5, 0.5, 5]), count: 3 };
    const mean = buildGridFromPointCloud(cloud, { cellSize: 1, fillPasses: 0 });
    expect(mean.grid.cols).toBe(2);
    expect(mean.grid.rows).toBe(1);
    expect(mean.grid.z[0]).toBe(2);
    expect(buildGridFromPointCloud(cloud, { cellSize: 1, aggregation: "min" }).grid.z[0]).toBe(1);
    expect(mean.validCells).toBe(2);
  });

  it("fills small holes but not open areas, and interpolates bilinearly", () => {
    const cloud = cloudFrom((x, y) => 2 * x + y, 0, 0, 10, 10, 0.5);
    // remove points in one cell to create a hole
    const kept: number[] = [];
    for (let i = 0; i < cloud.count * 3; i += 3) {
      const x = cloud.positions[i]!, y = cloud.positions[i + 1]!;
      if (!(x > 5 && x < 6 && y > 5 && y < 6)) kept.push(x, y, cloud.positions[i + 2]!);
    }
    const r = buildGridFromPointCloud({ positions: Float64Array.from(kept), count: kept.length / 3 }, { cellSize: 1 });
    expect(r.filledCells).toBe(1);
    expect(r.emptyCells).toBe(0);
    expect(elevationAt(r.grid, 3.5, 4.5)).toBeCloseTo(2 * 3.5 + 4.5, 9);
    expect(elevationAt(r.grid, 3.2, 4.7)).toBeCloseTo(2 * 3.2 + 4.7, 9); // planar → exact
    expect(elevationAt(r.grid, 50, 50)).toBeNaN();
    expect(summarizeGrid(r.grid).coveredArea).toBe(100);
  });

  it("round-trips through the MFDM encoding with NaN preserved", () => {
    const cloud = cloudFrom((x, y) => 112 + 0.01 * x + 0.02 * y, 598100, 6643200, 4, 3, 0.25);
    const { grid } = buildGridFromPointCloud(cloud, { cellSize: 1 });
    grid.z[0] = NaN;
    const back = decodeGrid(encodeGrid(grid));
    expect(back.cols).toBe(grid.cols);
    expect(back.originX).toBe(grid.originX);
    expect(back.z[0]).toBeNaN();
    for (let k = 1; k < grid.z.length; k++) expect(Math.abs(back.z[k]! - grid.z[k]!)).toBeLessThan(1e-5);
    expect(() => decodeGrid(new ArrayBuffer(4))).toThrow();
  });

  it("refuses grids that would be too large", () => {
    const cloud: PointCloud = { positions: Float64Array.from([0, 0, 0, 10000, 10000, 0]), count: 2 };
    expect(() => buildGridFromPointCloud(cloud, { cellSize: 0.01 })).toThrow(/cells/);
  });
});

describe("volumes (analytic checks)", () => {
  it("box on flat ground: 10×10×2 = 200 m³ against a fixed elevation", () => {
    const fn = (x: number, y: number) => (x > 5 && x < 15 && y > 5 && y < 15 ? 2 : 0);
    const { grid } = buildGridFromPointCloud(cloudFrom(fn, 0, 0, 20, 20, 0.1), { cellSize: 0.25 });
    const r = computeVolume(grid, { type: "elevation", z: 0 }, square(10, 10, 8));
    expect(r.volumeAbove).toBeCloseTo(200, 0);
    expect(r.volumeBelow).toBe(0);
    expect(r.area).toBeCloseTo(256, 9);
    expect(r.voidFraction).toBe(0);
    // Against a design level of 1 m: 100 m² × 1 m above, 156 m² × 1 m below.
    const design = computeVolume(grid, { type: "elevation", z: 1 }, square(10, 10, 8));
    expect(design.volumeAbove).toBeCloseTo(100, 0);
    expect(design.volumeBelow).toBeCloseTo(156, 0);
    expect(design.net).toBeCloseTo(-56, 0);
  });

  it("cone stockpile on a sloping site: πr²h/3 above the boundary plane", () => {
    const r0 = 9, h = 4;
    const fn = (x: number, y: number) => 100 + 0.02 * x + 0.01 * y + Math.max(0, h * (1 - Math.hypot(x - 20, y - 20) / r0));
    const { grid } = buildGridFromPointCloud(cloudFrom(fn, 0, 0, 40, 40, 0.1), { cellSize: 0.2 });
    const res = computeVolume(grid, { type: "boundary-plane" }, circle(20, 20, 11));
    const exact = (Math.PI * r0 * r0 * h) / 3; // 339.29
    expect(Math.abs(res.volumeAbove - exact) / exact).toBeLessThan(0.01);
    expect(res.volumeBelow).toBeLessThan(0.5);
    expect(res.reference.type).toBe("boundary-plane");
    if (res.reference.type === "boundary-plane") {
      expect(res.reference.plane.slopeX).toBeCloseTo(0.02, 3);
      expect(res.reference.plane.rmsResidual).toBeLessThan(0.01);
    }
    expect(res.warnings).toEqual([]);
  });

  it("excavation pit: truncated pyramid below the original ground", () => {
    // 18×18 m pit with 1:1 sides, max depth 2.5 → V = h/3·(A1 + A2 + √(A1·A2)) = 605.83 m³
    const fn = (x: number, y: number) => {
      const inPit = x > 10 && x < 28 && y > 10 && y < 28;
      return 50 - (inPit ? Math.min(2.5, x - 10, 28 - x, y - 10, 28 - y) : 0);
    };
    const { grid } = buildGridFromPointCloud(cloudFrom(fn, 0, 0, 38, 38, 0.1), { cellSize: 0.2 });
    const res = computeVolume(grid, { type: "lowest-boundary" }, square(19, 19, 11));
    expect(res.reference).toEqual({ type: "lowest-boundary", z: expect.closeTo(50, 6) });
    const exact = (2.5 / 3) * (324 + 169 + Math.sqrt(324 * 169));
    expect(Math.abs(res.volumeBelow - exact) / exact).toBeLessThan(0.01);
  });

  it("surface-to-surface comparison equals the difference volume", () => {
    const before = buildGridFromPointCloud(cloudFrom(() => 10, 0, 0, 20, 20, 0.25), { cellSize: 0.5 }).grid;
    const after = buildGridFromPointCloud(
      cloudFrom((x, y) => (x < 10 ? 11 : y < 10 ? 9.5 : 10), 0, 0, 20, 20, 0.25),
      { cellSize: 0.5 },
    ).grid;
    const r = computeVolume(after, { type: "surface", grid: before });
    expect(r.volumeAbove).toBeCloseTo(200, 6); // 10×20 m × +1 m
    expect(r.volumeBelow).toBeCloseTo(50, 6); // 10×10 m × −0.5 m
  });

  it("reports void areas and rejects bad input", () => {
    const { grid } = buildGridFromPointCloud(cloudFrom(() => 1, 0, 0, 10, 10, 0.5), { cellSize: 1 });
    const r = computeVolume(grid, { type: "elevation", z: 0 }, square(10, 5, 5)); // half outside data
    expect(r.voidFraction).toBeGreaterThan(0.4);
    expect(r.warnings.join(" ")).toMatch(/no surface data/);
    expect(r.volumeAbove).toBeCloseTo(50, 6);
    expect(() => computeVolume(grid, { type: "elevation", z: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toThrow(VolumeError);
    expect(() => computeVolume(grid, { type: "elevation", z: 0 }, square(100, 100, 2))).toThrow(/No surface data/);
    expect(() => fitPlane([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 2, y: 2, z: 0 }])).toThrow(/collinear/);
  });
});

describe("cross sections", () => {
  it("samples a profile along a polyline", () => {
    const { grid } = buildGridFromPointCloud(cloudFrom((x) => 0.1 * x, 0, 0, 20, 20, 0.25), { cellSize: 0.5 });
    const s = crossSection(grid, [{ x: 2, y: 10 }, { x: 18, y: 10 }], 1, grid);
    expect(s.length).toBe(16);
    expect(s.samples).toHaveLength(17);
    expect(s.samples[0]!.z).toBeCloseTo(0.2, 6);
    expect(s.samples.at(-1)!.z).toBeCloseTo(1.8, 6);
    expect(s.samples[3]!.zRef).toBeCloseTo(s.samples[3]!.z!, 9);
    expect(s.voidFraction).toBe(0);
    expect(thinProfile(s.samples, 5)).toHaveLength(5);
    expect(() => crossSection(grid, [{ x: 1, y: 1 }], 1)).toThrow();
  });
});

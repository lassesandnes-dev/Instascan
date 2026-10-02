import { describe, expect, it } from "vitest";
import {
  computeBoundingBox,
  computeStatistics,
  decodePointBuffer,
  encodePointCloud,
  measureDistance,
  measureElevationDifference,
  parseXyz,
  sceneObjectSchema,
  EXAMPLE_STONE_STEP,
  nominalSize,
  toWorld,
} from "../src";

describe("measureDistance", () => {
  it("computes true 3D distance and component differences", () => {
    const r = measureDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 });
    expect(r.distance3d).toBe(13);
    expect(r.horizontalDistance).toBe(5);
    expect([r.dx, r.dy, r.dz]).toEqual([3, 4, 12]);
    expect(r.slopePercent).toBeCloseTo(240);
  });

  it("is exact for large projected coordinates", () => {
    const a = { x: 598123.456, y: 6643210.789, z: 101.234 };
    const b = { x: 598126.456, y: 6643214.789, z: 101.234 };
    expect(measureDistance(a, b).distance3d).toBeCloseTo(5, 9);
  });

  it("handles vertical segments and rejects non-finite input", () => {
    expect(measureDistance({ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 2 }).slopePercent).toBeNull();
    expect(() => measureDistance({ x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(measureElevationDifference({ x: 0, y: 0, z: 10 }, { x: 5, y: 5, z: 7.5 })).toBe(-2.5);
  });
});

describe("statistics", () => {
  it("computes bbox, centroid, z stats and density", () => {
    const { cloud } = parseXyz("0 0 0\n10 0 2\n10 10 4\n0 10 6\n");
    const s = computeStatistics(cloud);
    expect(s.bbox).toEqual(computeBoundingBox(cloud));
    expect(s.extent).toEqual({ x: 10, y: 10, z: 6 });
    expect(s.centroid).toEqual({ x: 5, y: 5, z: 3 });
    expect(s.z.mean).toBe(3);
    expect(s.z.stdDev).toBeCloseTo(Math.sqrt(20 / 3));
    expect(s.planarDensity).toBeCloseTo(0.04);
  });
});

describe("MFPC encoding", () => {
  it("round-trips large coordinates with sub-millimetre error via a local origin", () => {
    const { cloud } = parseXyz(
      "598123.4561 6643210.7892 101.2343 255 0 0\n598223.0001 6643310.0002 121.0003 0 255 0\n",
    );
    const { buffer, origin } = encodePointCloud(cloud);
    const decoded = decodePointBuffer(buffer);
    expect(decoded.count).toBe(2);
    expect(decoded.origin).toEqual(origin);
    expect(Array.from(decoded.colors!)).toEqual([255, 0, 0, 0, 255, 0]);
    for (let k = 0; k < 2; k++) {
      const w = toWorld(
        { x: decoded.positions[k * 3]!, y: decoded.positions[k * 3 + 1]!, z: decoded.positions[k * 3 + 2]! },
        decoded.origin,
      );
      expect(Math.abs(w.x - cloud.positions[k * 3]!)).toBeLessThan(1e-4);
      expect(Math.abs(w.y - cloud.positions[k * 3 + 1]!)).toBeLessThan(1e-4);
      expect(Math.abs(w.z - cloud.positions[k * 3 + 2]!)).toBeLessThan(1e-4);
    }
  });

  it("rejects foreign or truncated buffers", () => {
    expect(() => decodePointBuffer(new ArrayBuffer(8))).toThrow();
    const { buffer } = encodePointCloud(parseXyz("1 2 3\n").cloud);
    expect(() => decodePointBuffer(buffer.slice(0, 44))).toThrow(/truncated/);
  });
});

describe("scene objects", () => {
  it("validates the stone step example and computes metre dimensions", () => {
    expect(sceneObjectSchema.parse(EXAMPLE_STONE_STEP).type).toBe("stone-step");
    expect(nominalSize(EXAMPLE_STONE_STEP)).toEqual({ x: 1.2, y: 0.4, z: 0.15 });
    expect(() => sceneObjectSchema.parse({ ...EXAMPLE_STONE_STEP, dimensions: { width: -1, depth: 1, height: 1 } })).toThrow();
  });
});

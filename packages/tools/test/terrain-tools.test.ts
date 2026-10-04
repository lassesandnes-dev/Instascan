import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry, type ToolContext } from "../src";
import { createFakeData, PROJECT_ID } from "./fake-data";

const registry = createDefaultToolRegistry();
const ctx = (selection: Partial<ToolContext["selection"]> = {}): ToolContext => ({
  projectId: PROJECT_ID,
  userId: "u",
  selection: { scanId: null, measurementId: null, objectIds: [], ...selection },
  data: createFakeData(),
});
const square = [{ x: 4, y: 4 }, { x: 16, y: 4 }, { x: 16, y: 16 }, { x: 4, y: 16 }];

describe("terrain tools", () => {
  it("lists surfaces", async () => {
    expect(await registry.execute("listSurfaces", {}, ctx())).toMatchObject({ ok: true, data: { count: 3 } });
  });

  it("calculateVolume against a fixed elevation (selected surface)", async () => {
    const r = await registry.execute(
      "calculateVolume",
      { reference: { type: "elevation", z: 10 }, boundary: square },
      ctx({ surfaceId: "surf_after" }),
    );
    expect(r.ok).toBe(true);
    const d = (r as { data: any }).data;
    expect(d.volumeAbove).toBeCloseTo(200, 6);
    expect(d.volumeBelow).toBeCloseTo(0, 9);
    expect(d.area).toBeCloseTo(144, 9);
    expect(d.units.volume).toBe("m³");
  });

  it("reuses a saved boundary and supports surface references", async () => {
    const r = await registry.execute(
      "calculateVolume",
      { surfaceId: "surf_after", reference: { type: "surface", surfaceId: "surf_before" }, fromVolumeId: "vol_1" },
      ctx(),
    );
    expect(r).toMatchObject({ ok: true, data: { volumeAbove: expect.closeTo(200, 6) } });
  });

  it("compareSurfaces reports added/removed volume and refuses different CRSs", async () => {
    const r = await registry.execute("compareSurfaces", { baseSurfaceId: "surf_before", topSurfaceId: "surf_after" }, ctx());
    expect(r).toMatchObject({ ok: true, data: { addedVolume: expect.closeTo(200, 6), removedVolume: expect.closeTo(0, 9) } });
    const bad = await registry.execute("compareSurfaces", { baseSurfaceId: "surf_other_crs", topSurfaceId: "surf_after" }, ctx());
    expect(bad).toMatchObject({ ok: false, error: { code: "validation_error", message: expect.stringMatching(/no conversion/) } });
  });

  it("createCrossSection returns a thinned profile", async () => {
    const r = await registry.execute(
      "createCrossSection",
      { surfaceId: "surf_after", line: [{ x: 1, y: 10 }, { x: 19, y: 10 }], interval: 0.05 },
      ctx(),
    );
    expect(r.ok).toBe(true);
    const d = (r as { data: any }).data;
    expect(d.length).toBe(18);
    expect(d.samples.length).toBeLessThanOrEqual(100);
    expect(d.zMax).toBeCloseTo(12, 6);
    expect(d.zMin).toBeCloseTo(10, 6);
  });

  it("validates references and surfaces", async () => {
    expect(await registry.execute("calculateVolume", { reference: { type: "elevation", z: 10 } }, ctx())).toMatchObject({
      ok: false,
      error: { code: "validation_error" },
    });
    expect(
      await registry.execute("calculateVolume", { surfaceId: "surf_after", reference: { type: "magic" } }, ctx()),
    ).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
    expect(
      await registry.execute("calculateVolume", { surfaceId: "nope", reference: { type: "lowest-boundary" } }, ctx()),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("getVolumeCalculation defaults to the selected volume", async () => {
    expect(await registry.execute("getVolumeCalculation", {}, ctx({ volumeId: "vol_1" }))).toMatchObject({
      ok: true,
      data: { id: "vol_1", volumeAbove: 200 },
    });
  });

  it("exposes JSON schema for the discriminated reference union", () => {
    const spec = registry.specs().find((s) => s.name === "calculateVolume")!;
    expect(JSON.stringify(spec.parameters)).toContain("boundary-plane");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createDefaultToolRegistry, PLANNED_TOOLS, type ToolContext } from "../src";
import { createFakeData, PROJECT_ID } from "./fake-data";

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    projectId: PROJECT_ID,
    userId: "user_1",
    selection: { scanId: null, measurementId: null, objectIds: [] },
    data: createFakeData(),
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  const registry = createDefaultToolRegistry();

  it("exposes JSON-schema specs for every tool and does not register planned tools", () => {
    const names = registry.specs().map((s) => s.name);
    expect(names).toContain("listScans");
    expect(names).toContain("getMeasurement");
    for (const planned of PLANNED_TOOLS) expect(names).not.toContain(planned.name);
    const measure = registry.specs().find((s) => s.name === "measureDistance")!;
    expect(measure.parameters).toMatchObject({ type: "object", required: ["from", "to"] });
  });

  it("lists scans for the context project only", async () => {
    const r = await registry.execute("listScans", {}, ctx());
    expect(r).toMatchObject({ ok: true, data: { count: 1, scans: [{ id: "scan_1", name: "Byggegrop nord" }] } });
    const other = await registry.execute("listScans", {}, ctx({ projectId: "someone-elses" }));
    expect(other).toMatchObject({ ok: true, data: { count: 0 } });
  });

  it("resolves the selected measurement when no id is given", async () => {
    const r = await registry.execute("getMeasurement", {}, ctx({ selection: { scanId: null, measurementId: "meas_1", objectIds: [] } }));
    expect(r).toMatchObject({ ok: true, data: { id: "meas_1", value: 13 } });
    const none = await registry.execute("getMeasurement", {}, ctx());
    expect(none).toMatchObject({ ok: false, error: { code: "validation_error" } });
  });

  it("validates arguments and rejects unknown keys and tools", async () => {
    expect(await registry.execute("measureDistance", { from: { x: 0, y: 0 }, to: { x: 1, y: 1, z: 1 } }, ctx())).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" },
    });
    expect(await registry.execute("listScans", { projectId: "x" }, ctx())).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
    expect(await registry.execute("getScanMetadata", { scanId: "../../etc" }, ctx())).toMatchObject({ ok: false });
    expect(await registry.execute("dropDatabase", {}, ctx())).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
  });

  it("computes geometry deterministically through the engine", async () => {
    const r = await registry.execute("measureDistance", { from: { x: 0, y: 0, z: 0 }, to: { x: 3, y: 4, z: 12 } }, ctx());
    expect(r).toMatchObject({ ok: true, data: { distance3d: 13, horizontalDistance: 5, dz: 12 } });
  });

  it("returns not_found for scans outside the project and reports bbox/statistics", async () => {
    expect(await registry.execute("getBoundingBox", { scanId: "nope" }, ctx())).toMatchObject({ ok: false, error: { code: "not_found" } });
    const bbox = await registry.execute("getBoundingBox", {}, ctx({ selection: { scanId: "scan_1", measurementId: null, objectIds: [] } }));
    expect(bbox).toMatchObject({ ok: true, data: { extent: { x: 10, y: 10, z: 6 }, crs: "EPSG:25832" } });
  });

  it("audits every call", async () => {
    const onAudit = vi.fn();
    await registry.execute("getProject", {}, ctx(), { onAudit });
    expect(onAudit).toHaveBeenCalledWith(expect.objectContaining({ toolName: "getProject", result: expect.objectContaining({ ok: true }) }));
  });
});

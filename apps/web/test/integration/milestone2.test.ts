import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonRequest, params, readNdjson, resetDatabase, sampleBytes } from "./helpers";
import { ScriptedProvider } from "@massefelt/ai/testing";
import { decodeGrid } from "@massefelt/geometry";
import * as projectsRoute from "@/app/api/projects/route";
import * as scansRoute from "@/app/api/projects/[projectId]/scans/route";
import * as buildSurfaceRoute from "@/app/api/scans/[scanId]/surfaces/route";
import * as surfacesRoute from "@/app/api/projects/[projectId]/surfaces/route";
import * as gridRoute from "@/app/api/surfaces/[surfaceId]/grid/route";
import * as volumesRoute from "@/app/api/projects/[projectId]/volumes/route";
import * as volumeRoute from "@/app/api/volumes/[volumeId]/route";
import * as sectionsRoute from "@/app/api/projects/[projectId]/sections/route";
import * as chatRoute from "@/app/api/ai/chat/route";
import { services, setServices } from "@/server/context";

// The sample: E0=598100, N0=6643200, ground z = 112 + 0.02·x + 0.01·y (local x,y),
// cone stockpile r=9 h=4 at (18,20); 18×18 pit with 1:1 sides, max depth 2.5, x∈[34,52], y∈[30,48].
const E0 = 598100, N0 = 6643200;
const circle = (cx: number, cy: number, r: number, n = 64) =>
  Array.from({ length: n }, (_, i) => ({ x: E0 + cx + r * Math.cos((2 * Math.PI * i) / n), y: N0 + cy + r * Math.sin((2 * Math.PI * i) / n) }));
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: E0 + x0, y: N0 + y0 }, { x: E0 + x1, y: N0 + y0 }, { x: E0 + x1, y: N0 + y1 }, { x: E0 + x0, y: N0 + y1 },
];
const CONE = (Math.PI * 81 * 4) / 3; // 339.29 m³
const PIT = (2.5 / 3) * (324 + 169 + Math.sqrt(324 * 169)); // 605.83 m³

let projectId = "";
let scanId = "";
let surfaceId = "";
let volumeId = "";

beforeAll(async () => {
  await resetDatabase();
  projectId = (await (await projectsRoute.POST(jsonRequest("/api/projects", "POST", { name: "M2" }))).json()).project.id;
  const form = new FormData();
  form.set("file", new File([new Uint8Array(sampleBytes())], "terrain.xyz"));
  form.set("crs", "EPSG:25832");
  form.set("verticalDatum", "NN2000");
  const up = await scansRoute.POST(new Request(`http://test/api/projects/${projectId}/scans`, { method: "POST", body: form }), params({ projectId }));
  scanId = (await up.json()).scanId;
});

afterAll(async () => {
  await services().db.$disconnect();
});

describe("milestone 2: surfaces, volumes, cross sections", () => {
  it("builds a DEM surface from the scan with provenance and lineage", async () => {
    const res = await buildSurfaceRoute.POST(jsonRequest("", "POST", { cellSize: 0.5, aggregation: "mean" }), params({ scanId }));
    expect(res.status).toBe(201);
    const { surface } = await res.json();
    surfaceId = surface.id;
    expect(surface).toMatchObject({ crs: "EPSG:25832", verticalDatum: "NN2000", units: "m", cellSize: 0.5, processingMethod: "dem-grid-mean" });
    expect(surface.zMin).toBeGreaterThan(108);
    const asset = await services().db.asset.findUniqueOrThrow({ where: { id: surfaceId }, include: { parentAsset: true } });
    expect(asset.parentAsset?.kind).toBe("POINT_CLOUD");
    const job = await services().db.processingJob.findFirstOrThrow({ where: { type: "surface.build", scanId } });
    expect(job.status).toBe("SUCCEEDED");

    const list = await (await surfacesRoute.GET(new Request("http://test"), params({ projectId }))).json();
    expect(list.surfaces).toHaveLength(1);
    const grid = decodeGrid(await (await gridRoute.GET(new Request("http://test"), params({ surfaceId }))).arrayBuffer());
    expect(grid.cellSize).toBe(0.5);
  });

  it("rejects absurd cell sizes", async () => {
    const res = await buildSurfaceRoute.POST(jsonRequest("", "POST", { cellSize: 0.001 }), params({ scanId }));
    expect(res.status).toBe(400);
  });

  it("stockpile volume above the boundary plane matches the analytic cone (±3 %)", async () => {
    const res = await volumesRoute.POST(
      jsonRequest("", "POST", { name: "Haug", surfaceId, boundary: circle(18, 20, 10.5), reference: { type: "boundary-plane" } }),
      params({ projectId }),
    );
    expect(res.status).toBe(201);
    const { volume } = await res.json();
    volumeId = volume.id;
    expect(Math.abs(volume.volumeAbove - CONE) / CONE).toBeLessThan(0.03);
    expect(volume.volumeBelow).toBeLessThan(2);
    expect(volume.crs).toBe("EPSG:25832");
    expect(volume.result.reference.plane.slopeX).toBeCloseTo(0.02, 2);
  });

  it("excavation volume below the boundary plane matches the analytic pit (±3 %)", async () => {
    const res = await volumesRoute.POST(
      jsonRequest("", "POST", { name: "Grop", surfaceId, boundary: rect(32, 28, 54, 50), reference: { type: "boundary-plane" } }),
      params({ projectId }),
    );
    const { volume } = await res.json();
    expect(Math.abs(volume.volumeBelow - PIT) / PIT).toBeLessThan(0.03);
  });

  it("validates boundaries and surface ownership", async () => {
    const bowtie = [rect(0, 0, 10, 10)[0], rect(0, 0, 10, 10)[2], rect(0, 0, 10, 10)[1], rect(0, 0, 10, 10)[3]];
    const bad = await volumesRoute.POST(jsonRequest("", "POST", { surfaceId, boundary: bowtie, reference: { type: "lowest-boundary" } }), params({ projectId }));
    expect(bad.status).toBe(400);
    const missing = await volumesRoute.POST(
      jsonRequest("", "POST", { surfaceId: "nope", boundary: rect(0, 0, 5, 5), reference: { type: "lowest-boundary" } }),
      params({ projectId }),
    );
    expect(missing.status).toBe(404);
  });

  it("saves a cross section through the stockpile", async () => {
    const res = await sectionsRoute.POST(
      jsonRequest("", "POST", { surfaceId, line: [{ x: E0 + 5, y: N0 + 20 }, { x: E0 + 31, y: N0 + 20 }], interval: 0.25 }),
      params({ projectId }),
    );
    expect(res.status).toBe(201);
    const { crossSection } = await res.json();
    expect(crossSection.length).toBeCloseTo(26, 9);
    const peak = 112 + 0.02 * 18 + 0.01 * 20 + 4;
    expect(Math.abs(crossSection.result.zMax - peak)).toBeLessThan(0.35); // grid smoothing at the apex
    expect(crossSection.result.samples.length).toBe(105);
  });

  it("AI calculates the volume of the selected volume's boundary via the calculateVolume tool", async () => {
    const provider = new ScriptedProvider(
      "anthropic",
      () => [{ toolCalls: [{ name: "calculateVolume", arguments: { reference: { type: "boundary-plane" }, fromVolumeId: volumeId } }] }],
      (results) => `Stockpile: ${(results[0]!.result as { volumeAbove: number }).volumeAbove.toFixed(1)} m³`,
    );
    setServices({ providers: { ...services().providers, anthropic: provider } });
    const res = await chatRoute.POST(
      jsonRequest("/api/ai/chat", "POST", {
        projectId,
        provider: "anthropic",
        message: "How large is the stockpile?",
        selection: { scanId, measurementId: null, objectIds: [], surfaceId, volumeId },
      }),
    );
    const events = await readNdjson(res);
    const tr = events.find((e) => e.type === "tool_result");
    expect(tr).toMatchObject({ name: "calculateVolume", ok: true });
    const saved = await (await volumesRoute.GET(new Request("http://test"), params({ projectId }))).json();
    // Identical to the saved UI calculation: same code path.
    expect(tr.result.volumeAbove).toBe(saved.volumes[0].volumeAbove);
    expect(provider.lastParams!.system).toContain(surfaceId);
    expect(provider.lastParams!.system).not.toMatch(/339|33\d\.\d/);
  });

  it("deletes a volume calculation", async () => {
    const res = await volumeRoute.DELETE(new Request("http://test"), params({ volumeId }));
    expect(res.status).toBe(204);
  });
});

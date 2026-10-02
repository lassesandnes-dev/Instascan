import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonRequest, params, readNdjson, resetDatabase, sampleBytes } from "./helpers";
import { ScriptedProvider } from "@massefelt/ai/testing";
import { decodePointBuffer } from "@massefelt/geometry";
import * as projectsRoute from "@/app/api/projects/route";
import * as scansRoute from "@/app/api/projects/[projectId]/scans/route";
import * as pointsRoute from "@/app/api/scans/[scanId]/points/route";
import * as measurementsRoute from "@/app/api/projects/[projectId]/measurements/route";
import * as chatRoute from "@/app/api/ai/chat/route";
import * as providersRoute from "@/app/api/ai/providers/route";
import { services, setServices } from "@/server/context";

let projectId = "";
let scanId = "";
let measurementId = "";

function uploadRequest(pid: string, bytes: Uint8Array | Buffer, filename: string, meta: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], filename, { type: "text/plain" }));
  for (const [k, v] of Object.entries(meta)) form.set(k, v);
  return new Request(`http://test/api/projects/${pid}/scans`, { method: "POST", body: form });
}

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await services().db.$disconnect();
});

describe("milestone 1 vertical slice (API + database)", () => {
  it("1–2. creates and lists a project", async () => {
    const res = await projectsRoute.POST(
      jsonRequest("/api/projects", "POST", { name: "Byggefelt Test", defaultCrs: "EPSG:25832", defaultVerticalDatum: "NN2000" }),
    );
    expect(res.status).toBe(201);
    projectId = (await res.json()).project.id;
    const list = await (await projectsRoute.GET()).json();
    expect(list.projects.map((p: { id: string }) => p.id)).toContain(projectId);
  });

  it("rejects invalid project input", async () => {
    const res = await projectsRoute.POST(jsonRequest("/api/projects", "POST", { name: "" }));
    expect(res.status).toBe(400);
  });

  it("4–6. uploads an XYZ file, parses points and saves metadata with provenance", async () => {
    const res = await scansRoute.POST(
      uploadRequest(projectId, sampleBytes(), "terrain.xyz", { crs: "EPSG:25832", verticalDatum: "NN2000", source: "file-import" }),
      params({ projectId }),
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.pointCount).toBe(22500);
    scanId = body.scanId;

    const { db } = services();
    const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, include: { files: true, assets: { include: { pointCloud: true } } } });
    expect(scan.status).toBe("READY");
    expect(scan.crs).toBe("EPSG:25832");
    expect(scan.files[0]!.originalFilename).toBe("terrain.xyz");
    expect(scan.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const asset = scan.assets[0]!;
    expect(asset).toMatchObject({
      kind: "POINT_CLOUD",
      originalFilename: "terrain.xyz",
      source: "file-import",
      crs: "EPSG:25832",
      verticalDatum: "NN2000",
      processingMethod: "xyz-ascii-import",
      units: "m",
    });
    expect(asset.pointCloud!.pointCount).toBe(22500);
    expect(asset.pointCloud!.minX).toBeGreaterThan(598000);
    const job = await db.processingJob.findFirstOrThrow({ where: { scanId } });
    expect(job).toMatchObject({ type: "pointcloud.import.xyz", status: "SUCCEEDED", executor: "inline" });
  });

  it("7. serves the web-optimized point buffer with exact world coordinates recoverable", async () => {
    const res = await pointsRoute.GET(new Request("http://test"), params({ scanId }));
    expect(res.status).toBe(200);
    const decoded = decodePointBuffer(await res.arrayBuffer());
    expect(decoded.count).toBe(22500);
    expect(decoded.colors).not.toBeNull();
    const firstWorldX = decoded.origin.x + decoded.positions[0]!;
    expect(Math.abs(firstWorldX - 598100.014)).toBeLessThan(1e-3);
  });

  it("rejects unsupported, planned, binary and malformed uploads", async () => {
    const exe = await scansRoute.POST(uploadRequest(projectId, Buffer.from("MZ\0\0"), "evil.exe"), params({ projectId }));
    expect(exe.status).toBe(400);
    const las = await scansRoute.POST(uploadRequest(projectId, Buffer.from("LASF"), "cloud.las"), params({ projectId }));
    expect(las.status).toBe(415);
    const bin = await scansRoute.POST(uploadRequest(projectId, Buffer.from([1, 2, 0, 3]), "bin.xyz"), params({ projectId }));
    expect(bin.status).toBe(400);
    const bad = await scansRoute.POST(uploadRequest(projectId, Buffer.from("foo,bar\n1,2\n"), "bad.csv"), params({ projectId }));
    expect(bad.status).toBe(422);
  });

  it("enforces the configured upload size limit", async () => {
    const { serverEnv } = await import("@/server/env");
    const env = serverEnv();
    const original = env.UPLOAD_MAX_BYTES;
    env.UPLOAD_MAX_BYTES = 10;
    try {
      const res = await scansRoute.POST(uploadRequest(projectId, Buffer.from("1 2 3\n4 5 6\n"), "small.xyz"), params({ projectId }));
      expect(res.status).toBe(413);
    } finally {
      env.UPLOAD_MAX_BYTES = original;
    }
  });

  it("11–13. saves a distance measurement recomputed by the engine", async () => {
    const res = await measurementsRoute.POST(
      jsonRequest(`/api/projects/${projectId}/measurements`, "POST", {
        scanId,
        from: { x: 598110, y: 6643210, z: 112.3 },
        to: { x: 598113, y: 6643214, z: 124.3 },
      }),
      params({ projectId }),
    );
    expect(res.status).toBe(201);
    const { measurement } = await res.json();
    measurementId = measurement.id;
    expect(measurement.value).toBeCloseTo(13, 9);
    expect(measurement.result).toMatchObject({ dx: 3, horizontalDistance: 5 });
    expect(measurement.result.dy).toBeCloseTo(4, 6);
    expect(measurement.result.dz).toBeCloseTo(12, 9);
    expect(measurement.crs).toBe("EPSG:25832");
    const list = await (await measurementsRoute.GET(new Request("http://test"), params({ projectId }))).json();
    expect(list.measurements).toHaveLength(1);
  });

  it("does not expose other projects (404)", async () => {
    const res = await measurementsRoute.GET(new Request("http://test"), params({ projectId: "does-not-exist" }));
    expect(res.status).toBe(404);
  });

  it("reports providers without secrets and returns 503 when the chosen provider has no key", async () => {
    const providers = await (await providersRoute.GET()).json();
    expect(providers.providers.every((p: { configured: boolean }) => p.configured === false)).toBe(true);
    const res = await chatRoute.POST(jsonRequest("/api/ai/chat", "POST", { projectId, provider: "openai", message: "hi" }));
    expect(res.status).toBe(503);
  });

  it("15–16. AI answers 'which scans' through the listScans tool, and the call is audited", async () => {
    const provider = new ScriptedProvider(
      "openai",
      () => [{ toolCalls: [{ name: "listScans", arguments: {} }] }],
      (results) => {
        const data = results[0]!.result as { scans: { name: string; pointCount: number }[] };
        return `Available scans: ${data.scans.map((s) => `${s.name} (${s.pointCount} points)`).join(", ")}`;
      },
    );
    setServices({ providers: { ...services().providers, openai: provider } });

    const res = await chatRoute.POST(
      jsonRequest("/api/ai/chat", "POST", {
        projectId,
        provider: "openai",
        message: "What scans are available in this project?",
        selection: { scanId, measurementId: null, objectIds: [] },
      }),
    );
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await readNdjson(res);
    expect(events[0]).toMatchObject({ type: "conversation" });
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toMatchObject({ name: "listScans", ok: true });
    expect(toolResult.result.scans[0]).toMatchObject({ id: scanId, pointCount: 22500 });
    const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
    expect(text).toContain("22500 points");

    // The system prompt carried identifiers, not data.
    expect(provider.lastParams!.system).toContain(scanId);
    expect(provider.lastParams!.system).not.toContain("22500");

    const audit = await services().db.aIToolCall.findMany({ where: { projectId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ toolName: "listScans", ok: true, provider: "openai" });
    const messages = await services().db.aIMessage.findMany({ where: { conversationId: events[0].id }, orderBy: { createdAt: "asc" } });
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("17–18. AI retrieves the selected measurement through getMeasurement (Claude path)", async () => {
    const provider = new ScriptedProvider(
      "anthropic",
      () => [{ toolCalls: [{ name: "getMeasurement", arguments: {} }] }],
      (results) => {
        const m = results[0]!.result as { name: string; value: number; units: string };
        return `${m.name} is ${m.value.toFixed(3)} ${m.units}.`;
      },
    );
    setServices({ providers: { ...services().providers, anthropic: provider } });
    const res = await chatRoute.POST(
      jsonRequest("/api/ai/chat", "POST", {
        projectId,
        provider: "anthropic",
        message: "What is the distance of the selected measurement?",
        selection: { scanId, measurementId, objectIds: [] },
      }),
    );
    const events = await readNdjson(res);
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({
      name: "getMeasurement",
      ok: true,
      result: { id: measurementId, value: 13 },
    });
    expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Distance 1 is 13.000 m.");
  });

  it("ignores selection ids from other projects", async () => {
    const other = await (await projectsRoute.POST(jsonRequest("/api/projects", "POST", { name: "Other" }))).json();
    const provider = new ScriptedProvider("anthropic", () => [{ toolCalls: [{ name: "getMeasurement", arguments: {} }] }], () => "done");
    setServices({ providers: { ...services().providers, anthropic: provider } });
    const res = await chatRoute.POST(
      jsonRequest("/api/ai/chat", "POST", {
        projectId: other.project.id,
        provider: "anthropic",
        message: "What is the distance of the selected measurement?",
        selection: { scanId, measurementId, objectIds: [] },
      }),
    );
    const events = await readNdjson(res);
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: false, result: { code: "validation_error" } });
  });
});

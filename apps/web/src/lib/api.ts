import type { CrossSectionRecord, MeasurementRecord, ScanDetail, ScanSummary, SurfaceSummary, VolumeRecord } from "@massefelt/tools";

export type { CrossSectionRecord, MeasurementRecord, ScanDetail, ScanSummary, SurfaceSummary, VolumeRecord };

export type VolumeReferenceInput =
  | { type: "elevation"; z: number }
  | { type: "lowest-boundary" }
  | { type: "boundary-plane" }
  | { type: "surface"; surfaceId: string };

const postJson = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  let message = `Request failed (${res.status})`;
  let code: string | undefined;
  try {
    const body = await res.json();
    message = body?.error?.message ?? message;
    code = body?.error?.code;
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(message, res.status, code);
}

export const api = {
  async createProject(input: { name: string; description?: string; defaultCrs?: string; defaultVerticalDatum?: string }) {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return handle<{ project: { id: string } }>(res);
  },
  async listScans(projectId: string) {
    return handle<{ scans: ScanSummary[] }>(await fetch(`/api/projects/${projectId}/scans`, { cache: "no-store" }));
  },
  async getScan(scanId: string) {
    return handle<{ scan: ScanDetail }>(await fetch(`/api/scans/${scanId}`, { cache: "no-store" }));
  },
  async uploadScan(projectId: string, form: FormData) {
    const res = await fetch(`/api/projects/${projectId}/scans`, { method: "POST", body: form });
    return handle<{ scanId: string; pointCount: number; skippedLines: number }>(res);
  },
  async deleteScan(scanId: string) {
    return handle<void>(await fetch(`/api/scans/${scanId}`, { method: "DELETE" }));
  },
  async getPointBuffer(scanId: string) {
    const res = await fetch(`/api/scans/${scanId}/points`);
    if (!res.ok) await handle(res);
    return res.arrayBuffer();
  },
  async listMeasurements(projectId: string) {
    return handle<{ measurements: MeasurementRecord[] }>(
      await fetch(`/api/projects/${projectId}/measurements`, { cache: "no-store" }),
    );
  },
  async createDistance(projectId: string, input: { scanId: string | null; from: Vec3Like; to: Vec3Like; name?: string }) {
    const res = await fetch(`/api/projects/${projectId}/measurements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return handle<{ measurement: MeasurementRecord }>(res);
  },
  async deleteMeasurement(id: string) {
    return handle<void>(await fetch(`/api/measurements/${id}`, { method: "DELETE" }));
  },
  async listSurfaces(projectId: string) {
    return handle<{ surfaces: SurfaceSummary[] }>(await fetch(`/api/projects/${projectId}/surfaces`, { cache: "no-store" }));
  },
  async buildSurface(scanId: string, input: { cellSize: number; aggregation: "mean" | "min" | "max"; name?: string }) {
    return handle<{ surface: SurfaceSummary }>(await postJson(`/api/scans/${scanId}/surfaces`, input));
  },
  async getSurfaceGrid(surfaceId: string) {
    const res = await fetch(`/api/surfaces/${surfaceId}/grid`);
    if (!res.ok) await handle(res);
    return res.arrayBuffer();
  },
  async deleteSurface(surfaceId: string) {
    return handle<void>(await fetch(`/api/surfaces/${surfaceId}`, { method: "DELETE" }));
  },
  async listVolumes(projectId: string) {
    return handle<{ volumes: VolumeRecord[] }>(await fetch(`/api/projects/${projectId}/volumes`, { cache: "no-store" }));
  },
  async createVolume(
    projectId: string,
    input: { name?: string; surfaceId: string; boundary: { x: number; y: number }[]; reference: VolumeReferenceInput },
  ) {
    return handle<{ volume: VolumeRecord }>(await postJson(`/api/projects/${projectId}/volumes`, input));
  },
  async deleteVolume(id: string) {
    return handle<void>(await fetch(`/api/volumes/${id}`, { method: "DELETE" }));
  },
  async listSections(projectId: string) {
    return handle<{ crossSections: CrossSectionRecord[] }>(await fetch(`/api/projects/${projectId}/sections`, { cache: "no-store" }));
  },
  async createSection(
    projectId: string,
    input: { name?: string; surfaceId: string; referenceSurfaceId?: string | null; line: { x: number; y: number }[]; interval?: number },
  ) {
    return handle<{ crossSection: CrossSectionRecord }>(await postJson(`/api/projects/${projectId}/sections`, input));
  },
  async deleteSection(id: string) {
    return handle<void>(await fetch(`/api/sections/${id}`, { method: "DELETE" }));
  },
  async providers() {
    return handle<{ providers: { id: "openai" | "anthropic"; label: string; model: string; configured: boolean }[] }>(
      await fetch("/api/ai/providers", { cache: "no-store" }),
    );
  },
};

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

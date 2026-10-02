import type { MeasurementRecord, ScanDetail, ScanSummary } from "@massefelt/tools";

export type { MeasurementRecord, ScanDetail, ScanSummary };

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

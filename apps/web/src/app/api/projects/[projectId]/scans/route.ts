import { ValidationError } from "@massefelt/shared";
import { getCurrentUser } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { json, route } from "@/server/http";
import { importPointFile, listScans } from "@/server/services/scans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { projectId } = await params;
  const user = await getCurrentUser();
  return json({ scans: await listScans(user, projectId) });
});

/** Multipart upload: field `file` plus optional metadata fields (name, source, acquisitionDate, crs, verticalDatum, units). */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { projectId } = await params;
  const user = await getCurrentUser();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > serverEnv().UPLOAD_MAX_BYTES + 64 * 1024) {
    return json({ error: { code: "file_too_large", message: "Upload exceeds the configured size limit" } }, { status: 413 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Missing file field");
  const meta: Record<string, string> = {};
  for (const key of ["name", "source", "acquisitionDate", "crs", "verticalDatum", "units"]) {
    const v = form.get(key);
    if (typeof v === "string" && v.trim()) meta[key] = v;
  }
  const result = await importPointFile(
    user,
    projectId,
    { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) },
    meta,
  );
  return json(result, { status: 201 });
});

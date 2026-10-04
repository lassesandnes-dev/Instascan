import { getCurrentUser } from "@/server/auth";
import { json, readJson, route } from "@/server/http";
import { buildSurface } from "@/server/services/surfaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Build a DEM grid surface from the scan's point cloud: { cellSize, aggregation?, name? } */
export const POST = route(async (request: Request, { params }: { params: Promise<{ scanId: string }> }) => {
  const { scanId } = await params;
  const surface = await buildSurface(await getCurrentUser(), scanId, await readJson(request));
  return json({ surface }, { status: 201 });
});

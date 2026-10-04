import { getCurrentUser } from "@/server/auth";
import { json, route } from "@/server/http";
import { listSurfaces } from "@/server/services/surfaces";

export const dynamic = "force-dynamic";

export const GET = route(async (_request: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const { projectId } = await params;
  return json({ surfaces: await listSurfaces(await getCurrentUser(), projectId) });
});

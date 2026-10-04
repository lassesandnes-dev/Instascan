import { getCurrentUser } from "@/server/auth";
import { json, readJson, route } from "@/server/http";
import { createVolume, listVolumes } from "@/server/services/volumes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { projectId } = await params;
  return json({ volumes: await listVolumes(await getCurrentUser(), projectId) });
});

export const POST = route(async (request: Request, { params }: Ctx) => {
  const { projectId } = await params;
  const volume = await createVolume(await getCurrentUser(), projectId, await readJson(request));
  return json({ volume }, { status: 201 });
});

import { getCurrentUser } from "@/server/auth";
import { json, readJson, route } from "@/server/http";
import { createCrossSection, listCrossSections } from "@/server/services/sections";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { projectId } = await params;
  return json({ crossSections: await listCrossSections(await getCurrentUser(), projectId) });
});

export const POST = route(async (request: Request, { params }: Ctx) => {
  const { projectId } = await params;
  const crossSection = await createCrossSection(await getCurrentUser(), projectId, await readJson(request));
  return json({ crossSection }, { status: 201 });
});

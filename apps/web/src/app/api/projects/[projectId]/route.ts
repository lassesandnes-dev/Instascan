import { getCurrentUser } from "@/server/auth";
import { services } from "@/server/context";
import { json, route } from "@/server/http";
import { requireProject } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export const GET = route(async (_request: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const { projectId } = await params;
  const user = await getCurrentUser();
  await requireProject(user, projectId);
  return json({ project: await services().data.getProject(projectId) });
});

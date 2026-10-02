import { getCurrentUser } from "@/server/auth";
import { json, readJson, route } from "@/server/http";
import { createProject, listProjects } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await getCurrentUser();
  return json({ projects: await listProjects(user) });
});

export const POST = route(async (request: Request) => {
  const user = await getCurrentUser();
  const project = await createProject(user, await readJson(request));
  return json({ project }, { status: 201 });
});

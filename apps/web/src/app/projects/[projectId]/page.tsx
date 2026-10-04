import { notFound } from "next/navigation";
import { isAppError } from "@massefelt/shared";
import { Workspace } from "@/components/workspace/Workspace";
import { getCurrentUser } from "@/server/auth";
import { services } from "@/server/context";
import { requireProject } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getCurrentUser();
  try {
    await requireProject(user, projectId);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
  const { data } = services();
  const [project, scans, measurements, surfaces, volumes, sections] = await Promise.all([
    data.getProject(projectId),
    data.listScans(projectId),
    data.listMeasurements(projectId),
    data.listSurfaces(projectId),
    data.listVolumes(projectId),
    data.listCrossSections(projectId),
  ]);
  if (!project) notFound();
  return (
    <Workspace
      project={project}
      initialScans={scans}
      initialMeasurements={measurements}
      initialSurfaces={surfaces}
      initialVolumes={volumes}
      initialSections={sections}
    />
  );
}

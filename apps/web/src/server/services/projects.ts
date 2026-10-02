import "server-only";
import { z } from "zod";
import { NotFoundError } from "@massefelt/shared";
import type { CurrentUser } from "../auth";
import { services } from "../context";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().transform((v) => v || null),
  defaultCrs: z.string().trim().max(128).optional().transform((v) => v || null),
  defaultVerticalDatum: z.string().trim().max(128).optional().transform((v) => v || null),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export interface ProjectListItem {
  id: string;
  name: string;
  description: string | null;
  defaultCrs: string | null;
  createdAt: string;
  scanCount: number;
}

export async function listProjects(user: CurrentUser): Promise<ProjectListItem[]> {
  const rows = await services().db.project.findMany({
    where: { organization: { memberships: { some: { userId: user.id } } } },
    include: { _count: { select: { scans: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    defaultCrs: p.defaultCrs,
    createdAt: p.createdAt.toISOString(),
    scanCount: p._count.scans,
  }));
}

export async function createProject(user: CurrentUser, input: unknown) {
  const data = createProjectSchema.parse(input);
  return services().db.project.create({
    data: { ...data, organizationId: user.organizationId, createdById: user.id },
  });
}

/** Load a project the user is allowed to access, or throw 404 (never leak existence). */
export async function requireProject(user: CurrentUser, projectId: string) {
  const project = await services().db.project.findFirst({
    where: { id: projectId, organization: { memberships: { some: { userId: user.id } } } },
  });
  if (!project) throw new NotFoundError("Project", projectId);
  return project;
}

import "server-only";
import { z } from "zod";
import { crossSection, GEOMETRY_ENGINE_VERSION } from "@massefelt/geometry";
import { NotFoundError, ValidationError } from "@massefelt/shared";
import { toCrossSectionRecord } from "@massefelt/database";
import type { CurrentUser } from "../auth";
import { services } from "../context";
import { requireProject } from "./projects";

const xy = z.object({ x: z.number().finite(), y: z.number().finite() });
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const createSectionSchema = z.object({
  name: z.string().trim().max(120).optional(),
  surfaceId: id,
  referenceSurfaceId: id.nullable().optional(),
  line: z.array(xy).min(2).max(100),
  interval: z.number().positive().max(1000).optional(),
});

/** Compute and save a terrain profile (full-resolution samples are stored). */
export async function createCrossSection(user: CurrentUser, projectId: string, input: unknown) {
  await requireProject(user, projectId);
  const req = createSectionSchema.parse(input);
  const { db, data } = services();
  const surface = await data.getSurface(projectId, req.surfaceId);
  const grid = await data.loadSurfaceGrid(projectId, req.surfaceId);
  if (!surface || !grid) throw new NotFoundError("Surface", req.surfaceId);
  let refGrid;
  if (req.referenceSurfaceId) {
    const ref = await data.getSurface(projectId, req.referenceSurfaceId);
    refGrid = await data.loadSurfaceGrid(projectId, req.referenceSurfaceId);
    if (!ref || !refGrid) throw new NotFoundError("Surface", req.referenceSurfaceId);
    if (ref.crs !== surface.crs || ref.units !== surface.units) {
      throw new ValidationError("Reference surface uses a different coordinate system or units; no conversion is performed");
    }
  }
  let section;
  try {
    section = crossSection(grid, req.line, req.interval ?? grid.cellSize, refGrid ?? undefined);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : String(err));
  }
  const count = await db.crossSection.count({ where: { projectId } });
  const row = await db.crossSection.create({
    data: {
      projectId,
      name: req.name || `Section ${count + 1}`,
      surfaceAssetId: req.surfaceId,
      referenceSurfaceId: req.referenceSurfaceId ?? null,
      line: req.line,
      length: section.length,
      interval: section.interval,
      result: JSON.parse(JSON.stringify({ zMin: section.zMin, zMax: section.zMax, voidFraction: section.voidFraction, samples: section.samples })),
      crs: surface.crs,
      units: surface.units,
      engineVersion: GEOMETRY_ENGINE_VERSION,
    },
  });
  return toCrossSectionRecord(row);
}

export async function listCrossSections(user: CurrentUser, projectId: string) {
  await requireProject(user, projectId);
  return services().data.listCrossSections(projectId);
}

export async function deleteCrossSection(user: CurrentUser, sectionId: string) {
  const { db } = services();
  const c = await db.crossSection.findUnique({ where: { id: sectionId } });
  if (!c) throw new NotFoundError("Cross section", sectionId);
  await requireProject(user, c.projectId);
  await db.crossSection.delete({ where: { id: sectionId } });
}

import "server-only";
import { z } from "zod";
import { GEOMETRY_ENGINE_VERSION, validatePolygon } from "@massefelt/geometry";
import { AppError, NotFoundError, ValidationError } from "@massefelt/shared";
import { toVolumeRecord } from "@massefelt/database";
import { calculateVolumeTool } from "@massefelt/tools";
import type { CurrentUser } from "../auth";
import { services } from "../context";
import { requireProject } from "./projects";
import { toolContextFor } from "./scope";

const xy = z.object({ x: z.number().finite(), y: z.number().finite() });
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const createVolumeSchema = z.object({
  name: z.string().trim().max(120).optional(),
  surfaceId: id,
  boundary: z.array(xy).min(3).max(2000),
  reference: z.discriminatedUnion("type", [
    z.object({ type: z.literal("elevation"), z: z.number().finite() }),
    z.object({ type: z.literal("lowest-boundary") }),
    z.object({ type: z.literal("boundary-plane") }),
    z.object({ type: z.literal("surface"), surfaceId: id }),
  ]),
});

/**
 * Calculate and save a volume. The computation goes through the same
 * `calculateVolume` tool the AI assistant uses, so UI and AI results are
 * identical by construction.
 */
export async function createVolume(user: CurrentUser, projectId: string, input: unknown) {
  await requireProject(user, projectId);
  const req = createVolumeSchema.parse(input);
  const invalid = validatePolygon(req.boundary);
  if (invalid) throw new ValidationError(invalid);
  const { db, data } = services();
  const surface = await data.getSurface(projectId, req.surfaceId);
  if (!surface) throw new NotFoundError("Surface", req.surfaceId);

  const parsed = calculateVolumeTool.inputSchema.parse({ surfaceId: req.surfaceId, reference: req.reference, boundary: req.boundary });
  const result = (await calculateVolumeTool.execute(parsed, toolContextFor(user, projectId))) as Record<string, unknown> & {
    volumeAbove: number;
    volumeBelow: number;
    net: number;
    area: number;
    reference: { type: string; z?: number };
  };
  if (!Number.isFinite(result.volumeAbove)) throw new AppError("volume_error", "Volume computation failed", 422);

  const count = await db.volumeCalculation.count({ where: { projectId } });
  const row = await db.volumeCalculation.create({
    data: {
      projectId,
      name: req.name || `Volume ${count + 1}`,
      method: req.reference.type,
      topSurfaceAssetId: req.surfaceId,
      baseSurfaceAssetId: req.reference.type === "surface" ? req.reference.surfaceId : null,
      referenceElevation: result.reference.z ?? null,
      boundary: req.boundary,
      area: result.area,
      cut: result.volumeAbove,
      fill: result.volumeBelow,
      net: result.net,
      result: JSON.parse(JSON.stringify(result)),
      crs: surface.crs,
      units: surface.units,
      engineVersion: GEOMETRY_ENGINE_VERSION,
    },
  });
  return toVolumeRecord(row);
}

export async function listVolumes(user: CurrentUser, projectId: string) {
  await requireProject(user, projectId);
  return services().data.listVolumes(projectId);
}

export async function deleteVolume(user: CurrentUser, volumeId: string) {
  const { db } = services();
  const v = await db.volumeCalculation.findUnique({ where: { id: volumeId } });
  if (!v) throw new NotFoundError("Volume calculation", volumeId);
  await requireProject(user, v.projectId);
  await db.volumeCalculation.delete({ where: { id: volumeId } });
}

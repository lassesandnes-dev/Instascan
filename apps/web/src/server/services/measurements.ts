import "server-only";
import { z } from "zod";
import { GEOMETRY_ENGINE_VERSION, measureDistance } from "@massefelt/geometry";
import { NotFoundError, ValidationError } from "@massefelt/shared";
import { toMeasurementRecord } from "@massefelt/database";
import type { CurrentUser } from "../auth";
import { services } from "../context";
import { requireProject } from "./projects";

const vec3 = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });

export const createDistanceSchema = z.object({
  name: z.string().trim().max(120).optional(),
  scanId: z.string().min(1).max(64).nullable().optional(),
  from: vec3,
  to: vec3,
});

/**
 * Save a distance measurement. The server recomputes every value with the
 * geometry engine; client-side numbers are display-only and never persisted.
 */
export async function createDistanceMeasurement(user: CurrentUser, projectId: string, input: unknown) {
  await requireProject(user, projectId);
  const data = createDistanceSchema.parse(input);
  const { db } = services();

  let crs: string | null = null;
  let units = "m";
  if (data.scanId) {
    const scan = await db.scan.findFirst({ where: { id: data.scanId, projectId } });
    if (!scan) throw new ValidationError("Scan does not belong to this project");
    crs = scan.crs;
    units = scan.units;
  }
  const result = measureDistance(data.from, data.to);
  const count = await db.measurement.count({ where: { projectId } });
  const row = await db.measurement.create({
    data: {
      projectId,
      scanId: data.scanId ?? null,
      type: "DISTANCE",
      name: data.name || `Distance ${count + 1}`,
      points: [data.from, data.to],
      value: result.distance3d,
      result: { ...result },
      crs,
      units,
      engineVersion: GEOMETRY_ENGINE_VERSION,
      createdById: user.id,
    },
  });
  return toMeasurementRecord(row);
}

export async function listMeasurements(user: CurrentUser, projectId: string) {
  await requireProject(user, projectId);
  return services().data.listMeasurements(projectId);
}

export async function deleteMeasurement(user: CurrentUser, measurementId: string) {
  const { db } = services();
  const m = await db.measurement.findUnique({ where: { id: measurementId } });
  if (!m) throw new NotFoundError("Measurement", measurementId);
  await requireProject(user, m.projectId);
  await db.measurement.delete({ where: { id: measurementId } });
}

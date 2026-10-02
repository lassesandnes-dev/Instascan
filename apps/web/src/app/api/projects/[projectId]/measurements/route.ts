import { getCurrentUser } from "@/server/auth";
import { json, readJson, route } from "@/server/http";
import { createDistanceMeasurement, listMeasurements } from "@/server/services/measurements";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { projectId } = await params;
  const user = await getCurrentUser();
  return json({ measurements: await listMeasurements(user, projectId) });
});

export const POST = route(async (request: Request, { params }: Ctx) => {
  const { projectId } = await params;
  const user = await getCurrentUser();
  const measurement = await createDistanceMeasurement(user, projectId, await readJson(request));
  return json({ measurement }, { status: 201 });
});

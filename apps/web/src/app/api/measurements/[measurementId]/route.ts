import { getCurrentUser } from "@/server/auth";
import { route } from "@/server/http";
import { deleteMeasurement } from "@/server/services/measurements";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ measurementId: string }> }) => {
  const { measurementId } = await params;
  await deleteMeasurement(await getCurrentUser(), measurementId);
  return new Response(null, { status: 204 });
});

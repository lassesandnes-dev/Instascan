import { getCurrentUser } from "@/server/auth";
import { route } from "@/server/http";
import { deleteSurface } from "@/server/services/surfaces";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ surfaceId: string }> }) => {
  const { surfaceId } = await params;
  await deleteSurface(await getCurrentUser(), surfaceId);
  return new Response(null, { status: 204 });
});

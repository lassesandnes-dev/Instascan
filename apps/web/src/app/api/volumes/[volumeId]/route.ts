import { getCurrentUser } from "@/server/auth";
import { route } from "@/server/http";
import { deleteVolume } from "@/server/services/volumes";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ volumeId: string }> }) => {
  const { volumeId } = await params;
  await deleteVolume(await getCurrentUser(), volumeId);
  return new Response(null, { status: 204 });
});

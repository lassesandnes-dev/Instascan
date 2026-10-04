import { getCurrentUser } from "@/server/auth";
import { route } from "@/server/http";
import { getSurfaceGridBytes } from "@/server/services/surfaces";

export const dynamic = "force-dynamic";

/** MFDM elevation grid (see @massefelt/geometry grid encoding). */
export const GET = route(async (_request: Request, { params }: { params: Promise<{ surfaceId: string }> }) => {
  const { surfaceId } = await params;
  const bytes = await getSurfaceGridBytes(await getCurrentUser(), surfaceId);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
});

import { getCurrentUser } from "@/server/auth";
import { route } from "@/server/http";
import { getScanPointBuffer } from "@/server/services/scans";

export const dynamic = "force-dynamic";

/** Web-optimized MFPC point buffer (see @massefelt/geometry encoding). */
export const GET = route(async (_request: Request, { params }: { params: Promise<{ scanId: string }> }) => {
  const { scanId } = await params;
  const bytes = await getScanPointBuffer(await getCurrentUser(), scanId);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
});

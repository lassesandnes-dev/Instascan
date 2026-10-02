import { getCurrentUser } from "@/server/auth";
import { json, route } from "@/server/http";
import { deleteScan, getScanDetail } from "@/server/services/scans";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ scanId: string }> };

export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { scanId } = await params;
  return json({ scan: await getScanDetail(await getCurrentUser(), scanId) });
});

export const DELETE = route(async (_request: Request, { params }: Ctx) => {
  const { scanId } = await params;
  await deleteScan(await getCurrentUser(), scanId);
  return new Response(null, { status: 204 });
});

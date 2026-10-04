import { getCurrentUser } from "@/server/auth";
import { route } from "@/server/http";
import { deleteCrossSection } from "@/server/services/sections";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ sectionId: string }> }) => {
  const { sectionId } = await params;
  await deleteCrossSection(await getCurrentUser(), sectionId);
  return new Response(null, { status: 204 });
});

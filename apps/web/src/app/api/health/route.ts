import { services } from "@/server/context";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await services().db.$queryRaw`SELECT 1`;
  return json({ status: "ok" });
});

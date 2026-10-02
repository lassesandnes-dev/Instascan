import { describeProviders } from "@massefelt/ai";
import { services } from "@/server/context";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Which AI providers are configured. Reports booleans only, never keys. */
export const GET = route(async () => json({ providers: describeProviders(services().providers) }));

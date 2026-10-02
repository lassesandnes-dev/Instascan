import "server-only";
import { AppError } from "@massefelt/shared";
import { services } from "./context";
import { serverEnv } from "./env";

export interface CurrentUser {
  id: string;
  email: string;
  organizationId: string;
}

/**
 * Resolve the signed-in user.
 *
 * AUTH_MODE=dev (default) provisions a single local user + organization so
 * the app works out of the box. AUTH_MODE=supabase is the planned production
 * path (verify the Supabase JWT, map `sub` to User.authSubject); it is not
 * implemented yet and fails closed.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const env = serverEnv();
  if (env.AUTH_MODE === "supabase") {
    throw new AppError("auth_not_implemented", "Supabase authentication is planned but not yet implemented.", 501);
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH_IN_PRODUCTION !== "true") {
    throw new AppError("auth_disabled", "Development authentication is disabled in production.", 401);
  }
  const { db } = services();
  const user = await db.user.upsert({
    where: { email: env.DEV_USER_EMAIL },
    update: {},
    create: { email: env.DEV_USER_EMAIL, name: "Local developer" },
  });
  let membership = await db.membership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!membership) {
    const org = await db.organization.upsert({
      where: { slug: "local" },
      update: {},
      create: { name: "Local organization", slug: "local" },
    });
    membership = await db.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: {},
      create: { userId: user.id, organizationId: org.id, role: "OWNER" },
    });
  }
  return { id: user.id, email: user.email, organizationId: membership.organizationId };
}

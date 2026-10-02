import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  AUTH_MODE: z.enum(["dev", "supabase"]).default("dev"),
  DEV_USER_EMAIL: z.string().email().default("dev@massefelt.local"),
  /** Maximum accepted upload size in bytes (default 100 MiB). */
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  /** Maximum number of points accepted from one point file. */
  UPLOAD_MAX_POINTS: z.coerce.number().int().positive().default(10_000_000),
  AI_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(20).default(8),
  AI_MAX_MESSAGE_CHARS: z.coerce.number().int().positive().default(8_000),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= schema.parse(process.env);
  return cached;
}

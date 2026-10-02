import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "dotenv";

const root = path.resolve(import.meta.dirname, "../../../..");
config({ path: path.join(root, ".env"), quiet: true });

// Point everything at the test database and a throwaway storage directory
// before any server module is imported.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_ROOT = mkdtempSync(path.join(os.tmpdir(), "mf-it-storage-"));
process.env.AUTH_MODE = "dev";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

export const SAMPLE_PATH = path.join(root, "samples/terrain-stockpile-epsg25832.xyz");
export const sampleBytes = () => readFileSync(SAMPLE_PATH);

export async function resetDatabase() {
  const { services } = await import("@/server/context");
  const { db } = services();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(`http://test${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function params<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

export async function readNdjson(res: Response): Promise<any[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

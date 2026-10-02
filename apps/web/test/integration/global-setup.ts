import { execFileSync } from "node:child_process";
import path from "node:path";
import { config } from "dotenv";

const root = path.resolve(import.meta.dirname, "../../../..");

/** Apply migrations to the disposable test database before the integration suite. */
export default function setup() {
  config({ path: path.join(root, ".env"), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests (see .env.example)");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — tests truncate tables");
  execFileSync("pnpm", ["--filter", "@massefelt/database", "exec", "prisma", "migrate", "deploy"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}

import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Load the monorepo root .env (if present) so CLI commands work from any directory.
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "postgresql://massefelt:massefelt@localhost:5432/massefelt",
  },
});

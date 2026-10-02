import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@/": path.resolve(root, "apps/web/src") + "/",
      // `server-only` throws outside React Server Components; tests run in plain Node.
      "server-only": path.resolve(root, "apps/web/test/stubs/server-only.ts"),
    },
  },
  test: {
    env: { LOG_LEVEL: "warn" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts", "apps/web/test/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          globalSetup: ["apps/web/test/integration/global-setup.ts"],
          include: ["apps/web/test/integration/**/*.test.ts", "packages/*/test-integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

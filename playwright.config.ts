import { defineConfig } from "@playwright/test";

/**
 * Browser smoke test of the milestone-1 workspace (requires PostgreSQL and
 * the dev server: `pnpm dev` in another terminal, or set E2E_START_SERVER=1).
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1600, height: 900 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: process.env.E2E_START_SERVER
    ? { command: "pnpm dev", url: "http://localhost:3000/api/health", reuseExistingServer: true, timeout: 120_000 }
    : undefined,
});

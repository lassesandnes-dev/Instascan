import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// The monorepo keeps a single .env at the repository root.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: [
    "@massefelt/ai",
    "@massefelt/database",
    "@massefelt/geometry",
    "@massefelt/shared",
    "@massefelt/storage",
    "@massefelt/tools",
  ],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;

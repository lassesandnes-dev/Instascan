/**
 * stdio MCP server for local use (e.g. Claude Desktop / Claude Code / other MCP clients).
 *
 *   MASSEFELT_PROJECT_ID=<id> MASSEFELT_USER_ID=<id> pnpm mcp
 *
 * In production the MCP endpoint must sit behind authentication that
 * resolves the user and authorises the project; this CLI is for development.
 */
import { config } from "dotenv";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getPrisma, PrismaProjectDataPort } from "@massefelt/database";
import { createStorageFromEnv } from "@massefelt/storage";
import { createDefaultToolRegistry } from "@massefelt/tools";
import { createMassefeltMcpServer } from "./index";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const projectId = process.env.MASSEFELT_PROJECT_ID;
if (!projectId) {
  console.error("MASSEFELT_PROJECT_ID is required");
  process.exit(1);
}
const db = getPrisma();
const storage = createStorageFromEnv();
const data = new PrismaProjectDataPort(db, (key) => storage.get(key));

const server = createMassefeltMcpServer({
  registry: createDefaultToolRegistry(),
  getContext: () => ({
    projectId,
    userId: process.env.MASSEFELT_USER_ID ?? "mcp-local",
    selection: { scanId: process.env.MASSEFELT_SCAN_ID ?? null, measurementId: null, objectIds: [] },
    data,
  }),
});

await server.connect(new StdioServerTransport());

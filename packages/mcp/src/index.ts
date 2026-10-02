import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolCallAudit, ToolContext, ToolRegistry } from "@massefelt/tools";

export interface McpServerOptions {
  registry: ToolRegistry;
  /** Resolves the server-side, project-scoped tool context for this session. */
  getContext: () => Promise<ToolContext> | ToolContext;
  onAudit?: (audit: ToolCallAudit) => void | Promise<void>;
}

/**
 * Expose the deterministic tool registry over the Model Context Protocol.
 * The same tool definitions, validation and project scoping used by the
 * in-app assistant apply here; MCP clients cannot pick a project.
 */
export function createMassefeltMcpServer(options: McpServerOptions): Server {
  const server = new Server({ name: "massefelt", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: options.registry.specs().map((spec) => ({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.parameters as { type: "object"; [k: string]: unknown },
      annotations: { readOnlyHint: options.registry.get(spec.name)?.readOnly ?? false },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const ctx = await options.getContext();
    const result = await options.registry.execute(request.params.name, request.params.arguments ?? {}, ctx, {
      onAudit: options.onAudit,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.ok ? result.data : result.error, null, 2) }],
      isError: !result.ok,
    };
  });

  return server;
}

import { z } from "zod";
import { isAppError, logger as rootLogger, type Logger } from "@massefelt/shared";
import type { ToolCallAudit, ToolContext, ToolDefinition, ToolResult, ToolSpec } from "./types";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const t of tools) this.register(t);
  }

  register(tool: ToolDefinition): void {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(tool.name)) throw new Error(`Invalid tool name: ${tool.name}`);
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** JSON-Schema specs for model providers / MCP. */
  specs(): ToolSpec[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.inputSchema),
    }));
  }

  /**
   * Validate and execute a tool call. Never throws: failures become a
   * structured error result that can be returned to the model.
   */
  async execute(
    name: string,
    rawArgs: unknown,
    ctx: ToolContext,
    options: { logger?: Logger; onAudit?: (audit: ToolCallAudit) => void | Promise<void> } = {},
  ): Promise<ToolResult> {
    const log = (options.logger ?? rootLogger).child({ tool: name, projectId: ctx.projectId, userId: ctx.userId });
    const started = performance.now();
    let result: ToolResult;
    const tool = this.tools.get(name);
    if (!tool) {
      result = { ok: false, error: { code: "unknown_tool", message: `Unknown tool: ${name}` } };
    } else {
      const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        result = {
          ok: false,
          error: { code: "invalid_arguments", message: "Tool arguments failed validation", details: z.treeifyError(parsed.error) },
        };
      } else {
        try {
          result = { ok: true, data: await tool.execute(parsed.data, ctx) };
        } catch (err) {
          result = isAppError(err)
            ? { ok: false, error: { code: err.code, message: err.message } }
            : { ok: false, error: { code: "tool_failed", message: err instanceof Error ? err.message : String(err) } };
          if (!isAppError(err)) log.error("tool execution failed", { err: String(err) });
        }
      }
    }
    const durationMs = Math.round(performance.now() - started);
    log.info("tool call", { ok: result.ok, durationMs, ...(result.ok ? {} : { error: result.error.code }) });
    if (options.onAudit) {
      try {
        await options.onAudit({ toolName: name, arguments: rawArgs, result, durationMs });
      } catch (err) {
        log.error("tool audit failed", { err: String(err) });
      }
    }
    return result;
  }
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

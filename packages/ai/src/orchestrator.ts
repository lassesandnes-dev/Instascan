import { logger as rootLogger, type Logger } from "@massefelt/shared";
import type { ToolCallAudit, ToolContext, ToolRegistry } from "@massefelt/tools";
import { buildSystemPrompt, type AssistantContext } from "./system-prompt";
import type { AIProvider, AIStreamEvent, ChatMessage } from "./types";

export interface RunAssistantParams {
  provider: AIProvider;
  registry: ToolRegistry;
  toolContext: ToolContext;
  assistantContext: AssistantContext;
  history: ChatMessage[];
  maxToolRounds?: number;
  signal?: AbortSignal;
  logger?: Logger;
  onToolAudit?: (audit: ToolCallAudit) => void | Promise<void>;
}

/**
 * Provider-neutral entry point: builds the system prompt, exposes the tool
 * registry, routes every tool call through validated registry execution and
 * streams events back. Provider errors are converted to an `error` event.
 */
export async function* runAssistant(params: RunAssistantParams): AsyncGenerator<AIStreamEvent> {
  const log = (params.logger ?? rootLogger).child({
    component: "ai",
    provider: params.provider.id,
    projectId: params.toolContext.projectId,
  });
  if (!params.provider.isConfigured()) {
    yield { type: "error", message: `${params.provider.label} is not configured on the server (missing API key).` };
    return;
  }
  const started = Date.now();
  try {
    yield* params.provider.run({
      system: buildSystemPrompt(params.assistantContext),
      messages: params.history,
      tools: params.registry.specs(),
      maxToolRounds: params.maxToolRounds ?? 8,
      signal: params.signal,
      executeTool: (call) =>
        params.registry.execute(call.name, call.arguments, params.toolContext, {
          logger: log,
          onAudit: params.onToolAudit,
        }),
    });
    log.info("assistant turn complete", { durationMs: Date.now() - started });
  } catch (err) {
    log.error("assistant turn failed", { err: err instanceof Error ? err.message : String(err) });
    yield { type: "error", message: publicErrorMessage(err) };
  }
}

function publicErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "Request was cancelled.";
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return "The AI provider rejected the server's credentials.";
  if (status === 429) return "The AI provider is rate limiting requests. Please retry shortly.";
  if (typeof status === "number" && status >= 500) return "The AI provider is temporarily unavailable.";
  return "The AI request failed. See server logs for details.";
}

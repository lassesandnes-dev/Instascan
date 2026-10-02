import type { ToolResult, ToolSpec } from "@massefelt/tools";

export type ProviderId = "openai" | "anthropic";

/** Provider-neutral conversation history (text turns only). */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: unknown;
}

/** Events streamed to the client (NDJSON). */
export type AIStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; arguments: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; result: unknown }
  | { type: "done"; stopReason: string; model: string }
  | { type: "error"; message: string };

export interface ProviderRunParams {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  executeTool(call: ToolCallRequest): Promise<ToolResult>;
  maxToolRounds: number;
  signal?: AbortSignal;
}

/**
 * Vendor abstraction. Each provider owns its native message format and
 * tool-call loop; tool execution is always delegated to `executeTool`, so the
 * deterministic tool layer remains the single source of geometric truth.
 */
export interface AIProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  isConfigured(): boolean;
  run(params: ProviderRunParams): AsyncIterable<AIStreamEvent>;
}

/** Max characters of a serialized tool result returned to a model. */
export const MAX_TOOL_RESULT_CHARS = 20_000;

export function serializeToolResult(result: ToolResult): string {
  const json = JSON.stringify(result);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return JSON.stringify({
    ok: false,
    error: { code: "result_too_large", message: `Tool result exceeded ${MAX_TOOL_RESULT_CHARS} characters; request a narrower query.` },
  });
}

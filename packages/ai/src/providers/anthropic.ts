import Anthropic from "@anthropic-ai/sdk";
import type { ToolSpec } from "@massefelt/tools";
import { serializeToolResult, type AIProvider, type AIStreamEvent, type ProviderRunParams } from "../types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  effort?: Effort;
  /** Server-side refusal fallback routing ("default") or disabled ("off"). */
  fallbacks?: "default" | "off";
  maxTokens?: number;
  /** Injected client (tests). */
  client?: Pick<Anthropic, "beta">;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

function toAnthropicTool(spec: ToolSpec): Anthropic.Beta.Messages.BetaTool {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.parameters as Anthropic.Beta.Messages.BetaTool.InputSchema,
    // Stream tool inputs as generated; inputs are validated by the tool registry before execution.
    eager_input_streaming: true,
  };
}

/** Claude via the Anthropic Messages API (streaming, manual tool loop). */
export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly label = "Claude";
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly effort: Effort;
  private readonly fallbacks: "default" | "off";
  private readonly maxTokens: number;
  private client: Pick<Anthropic, "beta"> | undefined;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.effort = options.effort ?? "medium";
    this.fallbacks = options.fallbacks ?? "default";
    this.maxTokens = options.maxTokens ?? 16_000;
    this.client = options.client;
  }

  isConfigured(): boolean {
    return Boolean(this.client || this.apiKey);
  }

  private getClient(): Pick<Anthropic, "beta"> {
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  async *run(params: ProviderRunParams): AsyncGenerator<AIStreamEvent> {
    const client = this.getClient();
    const tools = params.tools.map(toAnthropicTool);
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = params.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    let jsonRetries = 0;

    for (let round = 0; round <= params.maxToolRounds; round++) {
      const stream = client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: params.system,
          messages,
          tools,
          output_config: { effort: this.effort },
          ...(this.fallbacks === "default"
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
        },
        { signal: params.signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", delta: event.delta.text };
        }
      }

      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // With eager input streaming an unparseable tool input rejects here; retry that turn once or twice.
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        continue;
      }

      if (message.stop_reason === "refusal") {
        yield { type: "text", delta: "\n\n(The model declined to answer this request.)" };
        yield { type: "done", stopReason: "refusal", model: message.model };
        return;
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }

      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) {
        yield { type: "done", stopReason: message.stop_reason ?? "end_turn", model: message.model };
        return;
      }
      if (message.stop_reason === "max_tokens") {
        throw new Error("Tool input truncated at max_tokens");
      }
      if (round === params.maxToolRounds) break;

      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        yield { type: "tool_call", id: use.id, name: use.name, arguments: use.input };
        const result = await params.executeTool({ id: use.id, name: use.name, arguments: use.input });
        yield { type: "tool_result", id: use.id, name: use.name, ok: result.ok, result: result.ok ? result.data : result.error };
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: serializeToolResult(result),
          ...(result.ok ? {} : { is_error: true }),
        });
      }
      // All tool results for one assistant turn go back in a single user message.
      messages.push({ role: "user", content: results });
    }

    yield { type: "text", delta: "\n\n(Stopped: tool-call limit reached for this question.)" };
    yield { type: "done", stopReason: "tool_round_limit", model: this.model };
  }
}

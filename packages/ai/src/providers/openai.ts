import OpenAI from "openai";
import type { ToolSpec } from "@massefelt/tools";
import { serializeToolResult, type AIProvider, type AIStreamEvent, type ProviderRunParams } from "../types";

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  /** Injected client (tests). */
  client?: Pick<OpenAI, "responses">;
}

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

type InputItem = OpenAI.Responses.ResponseInputItem;

function toOpenAITool(spec: ToolSpec): OpenAI.Responses.FunctionTool {
  return {
    type: "function",
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    // Optional arguments are allowed, so strict mode is off; the tool registry validates every call.
    strict: false,
  };
}

/** OpenAI via the Responses API (streaming, stateless function-calling loop). */
export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly label = "OpenAI";
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly maxOutputTokens: number;
  private client: Pick<OpenAI, "responses"> | undefined;

  constructor(options: OpenAIProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.maxOutputTokens = options.maxOutputTokens ?? 16_000;
    this.client = options.client;
  }

  isConfigured(): boolean {
    return Boolean(this.client || this.apiKey);
  }

  private getClient(): Pick<OpenAI, "responses"> {
    this.client ??= new OpenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async *run(params: ProviderRunParams): AsyncGenerator<AIStreamEvent> {
    const client = this.getClient();
    const tools = params.tools.map(toOpenAITool);
    const input: InputItem[] = params.messages.map((m) => ({ role: m.role, content: m.content }));

    for (let round = 0; round <= params.maxToolRounds; round++) {
      // store:false keeps conversations out of OpenAI-side storage; reasoning
      // items are round-tripped via encrypted content instead.
      const stream = client.responses.stream(
        {
          model: this.model,
          instructions: params.system,
          input,
          tools,
          store: false,
          include: ["reasoning.encrypted_content"],
          max_output_tokens: this.maxOutputTokens,
        },
        { signal: params.signal },
      );
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") yield { type: "text", delta: event.delta };
      }
      const response = await stream.finalResponse();

      if (response.status === "failed") {
        throw new Error(response.error?.message ?? "OpenAI response failed");
      }
      const output = response.output as OpenAI.Responses.ResponseOutputItem[];
      const calls = output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
      );
      if (calls.length === 0) {
        yield {
          type: "done",
          stopReason: response.status === "incomplete" ? (response.incomplete_details?.reason ?? "incomplete") : "end_turn",
          model: response.model,
        };
        return;
      }
      if (round === params.maxToolRounds) break;

      input.push(...(output as InputItem[]));
      for (const call of calls) {
        let args: unknown;
        let result;
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = call.arguments;
          result = { ok: false as const, error: { code: "invalid_json", message: "Tool arguments were not valid JSON" } };
        }
        yield { type: "tool_call", id: call.call_id, name: call.name, arguments: args };
        result ??= await params.executeTool({ id: call.call_id, name: call.name, arguments: args });
        yield { type: "tool_result", id: call.call_id, name: call.name, ok: result.ok, result: result.ok ? result.data : result.error };
        input.push({ type: "function_call_output", call_id: call.call_id, output: serializeToolResult(result) });
      }
    }

    yield { type: "text", delta: "\n\n(Stopped: tool-call limit reached for this question.)" };
    yield { type: "done", stopReason: "tool_round_limit", model: this.model };
  }
}

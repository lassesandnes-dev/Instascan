import type { AIProvider, AIStreamEvent, ProviderId, ProviderRunParams } from "./types";

/**
 * Deterministic provider for tests: plays back a fixed sequence of tool calls,
 * executes them through the real tool layer, then writes an answer derived
 * from the tool results. It is never exposed in the UI.
 */
export interface ScriptStep {
  toolCalls: { name: string; arguments: unknown }[];
}

export class ScriptedProvider implements AIProvider {
  readonly label = "Scripted (test)";
  readonly model = "scripted";
  public lastParams: ProviderRunParams | undefined;

  constructor(
    readonly id: ProviderId,
    private readonly script: (params: ProviderRunParams) => ScriptStep[],
    private readonly answer: (results: { name: string; result: unknown }[]) => string,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async *run(params: ProviderRunParams): AsyncGenerator<AIStreamEvent> {
    this.lastParams = params;
    const results: { name: string; result: unknown }[] = [];
    let n = 0;
    for (const step of this.script(params)) {
      for (const call of step.toolCalls) {
        const id = `call_${++n}`;
        yield { type: "tool_call", id, name: call.name, arguments: call.arguments };
        const r = await params.executeTool({ id, name: call.name, arguments: call.arguments });
        const result = r.ok ? r.data : r.error;
        results.push({ name: call.name, result });
        yield { type: "tool_result", id, name: call.name, ok: r.ok, result };
      }
    }
    yield { type: "text", delta: this.answer(results) };
    yield { type: "done", stopReason: "end_turn", model: this.model };
  }
}

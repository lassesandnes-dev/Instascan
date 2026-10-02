import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider, OpenAIProvider, runAssistant, buildSystemPrompt, createProvidersFromEnv, describeProviders } from "../src";
import { assistantContext, collect, fakeStream, registry, toolContext } from "./helpers";

describe("AnthropicProvider", () => {
  it("runs a streaming tool loop and returns tool results in one user message", async () => {
    const calls: any[] = [];
    const responses = [
      fakeStream(
        [],
        {
          model: "claude-opus-5-5",
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Checking." },
            { type: "tool_use", id: "tu_1", name: "getMeasurement", input: {} },
          ],
        },
        "finalMessage",
      ),
      fakeStream(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "The distance is 13.000 m." } }],
        { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "The distance is 13.000 m." }] },
        "finalMessage",
      ),
    ];
    const client = {
      beta: {
        messages: {
          stream: vi.fn((params: any) => {
            calls.push(structuredClone(params));
            return responses.shift();
          }),
        },
      },
    };
    const provider = new AnthropicProvider({ client: client as any });
    const events = await collect(
      runAssistant({
        provider,
        registry,
        toolContext: toolContext({ measurementId: "meas_1" }),
        assistantContext,
        history: [{ role: "user", content: "What is the distance of the selected measurement?" }],
      }),
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call", name: "getMeasurement" }));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_result", name: "getMeasurement", ok: true, result: expect.objectContaining({ value: 13 }) }),
    );
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "end_turn" });

    // First request: model, tools, effort, fallbacks.
    expect(calls[0]).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "medium" }, fallbacks: "default" });
    expect(calls[0].tools.map((t: any) => t.name)).toContain("getMeasurement");
    expect(calls[0].system).toContain("Never guess");
    // Second request: assistant content echoed, followed by the tool_result.
    const last = calls[1].messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
    expect(JSON.parse(last.content[0].content)).toMatchObject({ ok: true, data: { id: "meas_1", value: 13 } });
  });

  it("reports a missing API key instead of calling the vendor", async () => {
    const events = await collect(
      runAssistant({
        provider: new AnthropicProvider({}),
        registry,
        toolContext: toolContext(),
        assistantContext,
        history: [{ role: "user", content: "hi" }],
      }),
    );
    expect(events).toEqual([{ type: "error", message: expect.stringContaining("not configured") }]);
  });

  it("stops at the tool round limit", async () => {
    const client = {
      beta: {
        messages: {
          stream: vi.fn(() =>
            fakeStream([], { model: "m", stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "listScans", input: {} }] }, "finalMessage"),
          ),
        },
      },
    };
    const events = await collect(
      new AnthropicProvider({ client: client as any }).run({
        system: "s",
        messages: [{ role: "user", content: "loop" }],
        tools: registry.specs(),
        maxToolRounds: 2,
        executeTool: (c) => registry.execute(c.name, c.arguments, toolContext()),
      }),
    );
    expect(client.beta.messages.stream).toHaveBeenCalledTimes(3);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "tool_round_limit" });
  });
});

describe("OpenAIProvider (Responses API)", () => {
  it("runs function calls through the tool layer and sends function_call_output back", async () => {
    const calls: any[] = [];
    const responses = [
      fakeStream(
        [],
        {
          model: "gpt-5.5",
          status: "completed",
          output: [{ type: "function_call", call_id: "c1", name: "listScans", arguments: "{}", id: "fc_1" }],
        },
        "finalResponse",
      ),
      fakeStream(
        [{ type: "response.output_text.delta", delta: "One scan: Byggegrop nord." }],
        { model: "gpt-5.5", status: "completed", output: [{ type: "message", role: "assistant", content: [] }] },
        "finalResponse",
      ),
    ];
    const client = {
      responses: {
        stream: vi.fn((params: any) => {
          calls.push(structuredClone(params));
          return responses.shift();
        }),
      },
    };
    const events = await collect(
      runAssistant({
        provider: new OpenAIProvider({ client: client as any }),
        registry,
        toolContext: toolContext(),
        assistantContext,
        history: [{ role: "user", content: "What scans are available in this project?" }],
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_result", name: "listScans", ok: true, result: expect.objectContaining({ count: 1 }) }),
    );
    expect(events).toContainEqual({ type: "text", delta: "One scan: Byggegrop nord." });
    expect(calls[0]).toMatchObject({ model: "gpt-5.5", store: false });
    expect(calls[0].tools[0]).toMatchObject({ type: "function" });
    const output = calls[1].input.at(-1);
    expect(output).toMatchObject({ type: "function_call_output", call_id: "c1" });
    expect(JSON.parse(output.output)).toMatchObject({ ok: true, data: { scans: [{ id: "scan_1" }] } });
  });

  it("returns invalid JSON arguments to the model as an error without executing", async () => {
    const exec = vi.fn();
    const responses = [
      fakeStream([], { model: "m", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "listScans", arguments: "{oops" }] }, "finalResponse"),
      fakeStream([], { model: "m", status: "completed", output: [] }, "finalResponse"),
    ];
    const client = { responses: { stream: vi.fn(() => responses.shift()) } };
    const events = await collect(
      new OpenAIProvider({ client: client as any }).run({
        system: "s",
        messages: [{ role: "user", content: "x" }],
        tools: [],
        maxToolRounds: 3,
        executeTool: exec,
      }),
    );
    expect(exec).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_result", ok: false }));
  });
});

describe("provider registry and prompt", () => {
  it("reads keys from env without exposing them", () => {
    const providers = createProvidersFromEnv({ OPENAI_API_KEY: "sk-test", NODE_ENV: "test" } as NodeJS.ProcessEnv);
    const info = describeProviders(providers);
    expect(info).toEqual([
      { id: "openai", label: "OpenAI", model: "gpt-5.5", configured: true },
      { id: "anthropic", label: "Claude", model: "claude-opus-5-5", configured: false },
    ]);
    expect(JSON.stringify(info)).not.toContain("sk-test");
  });

  it("system prompt contains identifiers but no geometry", () => {
    const prompt = buildSystemPrompt(assistantContext);
    expect(prompt).toContain("meas_1");
    expect(prompt).not.toMatch(/13(\.0+)?\s*m/);
  });
});

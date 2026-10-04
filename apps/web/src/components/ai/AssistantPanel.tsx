"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type ProviderId = "openai" | "anthropic";

interface ToolEvent {
  id: string;
  name: string;
  arguments: unknown;
  ok?: boolean;
  result?: unknown;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  tools: ToolEvent[];
  error?: string;
}

interface Props {
  projectId: string;
  selection: {
    scanId: string | null;
    measurementId: string | null;
    objectIds: string[];
    surfaceId?: string | null;
    volumeId?: string | null;
  };
  selectionLabel: string;
}

const SUGGESTIONS = [
  "What scans are available in this project?",
  "What is the distance of the selected measurement?",
  "How large is the selected volume calculation?",
];

export function AssistantPanel({ projectId, selection, selectionLabel }: Props) {
  const [providers, setProviders] = useState<{ id: ProviderId; label: string; model: string; configured: boolean }[]>([]);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .providers()
      .then(({ providers }) => {
        setProviders(providers);
        const firstConfigured = providers.find((p) => p.configured);
        if (firstConfigured) setProvider(firstConfigured.id);
      })
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  const current = providers.find((p) => p.id === provider);

  function updateLast(fn: (t: Turn) => Turn) {
    setTurns((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1]!)]);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setTurns((prev) => [...prev, { role: "user", text: message, tools: [] }, { role: "assistant", text: "", tools: [] }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, provider, conversationId: conversationId.current, message, selection }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          switch (ev.type) {
            case "conversation":
              conversationId.current = ev.id;
              break;
            case "text":
              updateLast((t) => ({ ...t, text: t.text + ev.delta }));
              break;
            case "tool_call":
              updateLast((t) => ({ ...t, tools: [...t.tools, { id: ev.id, name: ev.name, arguments: ev.arguments }] }));
              break;
            case "tool_result":
              updateLast((t) => ({
                ...t,
                tools: t.tools.map((x) => (x.id === ev.id ? { ...x, ok: ev.ok, result: ev.result } : x)),
              }));
              break;
            case "error":
              updateLast((t) => ({ ...t, error: ev.message }));
              break;
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        updateLast((t) => ({ ...t, error: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-full flex-col" data-testid="ai-panel">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-white">AI assistant</h2>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderId)}
          className="ml-auto rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          aria-label="AI provider"
          data-testid="ai-provider"
        >
          {(providers.length ? providers : [
            { id: "anthropic" as const, label: "Claude", configured: false, model: "" },
            { id: "openai" as const, label: "OpenAI", configured: false, model: "" },
          ]).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.configured ? "" : " (not configured)"}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            conversationId.current = null;
            setTurns([]);
          }}
          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
          title="Start a new conversation"
        >
          New
        </button>
      </div>
      <div className="border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-500">
        Context: {selectionLabel || "no selection"}
        {current && <span className="float-right">{current.model}</span>}
      </div>
      {current && !current.configured && (
        <div className="m-3 rounded border border-amber-800 bg-amber-950/50 p-2 text-xs text-amber-200">
          {current.label} is not configured. Set {current.id === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} in the server
          environment and restart.
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm" data-testid="ai-messages">
        {turns.length === 0 && (
          <div className="space-y-2 text-xs text-slate-400">
            <p>Ask about this project. The assistant reads data only through audited, deterministic tools.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => void send(s)} className="block w-full rounded border border-slate-700 px-2 py-1.5 text-left hover:bg-slate-900">
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "ml-8 rounded-md bg-sky-900/40 px-3 py-2 text-slate-100" : "mr-2"}>
            {t.tools.map((tool) => (
              <details key={tool.id} className="mb-1 rounded border border-slate-800 bg-slate-900/70 px-2 py-1 text-[11px]" data-testid="ai-tool-call">
                <summary className="cursor-pointer text-slate-300">
                  <span className={tool.ok === undefined ? "text-amber-400" : tool.ok ? "text-emerald-400" : "text-red-400"}>●</span>{" "}
                  tool: <span className="font-mono">{tool.name}</span>
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-slate-400">
                  {JSON.stringify({ arguments: tool.arguments, result: tool.result }, null, 2)}
                </pre>
              </details>
            ))}
            {t.text && <div className="whitespace-pre-wrap text-slate-200">{t.text}</div>}
            {t.role === "assistant" && !t.text && !t.error && busy && i === turns.length - 1 && (
              <div className="text-xs text-slate-500">Thinking…</div>
            )}
            {t.error && <div className="text-xs text-red-400" role="alert">{t.error}</div>}
          </div>
        ))}
      </div>

      <form
        className="border-t border-slate-800 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Ask about scans, measurements…"
          className="w-full resize-none rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          data-testid="ai-input"
        />
        <div className="mt-2 flex justify-end gap-2">
          {busy && (
            <button type="button" onClick={() => abortRef.current?.abort()} className="rounded px-3 py-1 text-xs text-slate-300 hover:bg-slate-800">
              Stop
            </button>
          )}
          <button type="submit" disabled={busy || !input.trim()} className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50" data-testid="ai-send">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

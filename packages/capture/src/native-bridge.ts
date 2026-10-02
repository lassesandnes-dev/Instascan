/**
 * Request/response bridge between the web app and a native shell
 * (iOS WKWebView today; Android WebView later). The protocol is documented in
 * docs/insta360-architecture.md.
 *
 *   web → native:  postMessage({ id, method, params })
 *   native → web:  window.__massefeltNative.receive({ id, ok, result | error })
 *   native → web:  window.__massefeltNative.receive({ event, data })   (unsolicited events)
 */
export interface BridgeRequest {
  id: string;
  method: string;
  params?: unknown;
}

export type BridgeMessage =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } }
  | { event: string; data: unknown };

export interface NativeTransport {
  post(request: BridgeRequest): void;
}

export interface NativeBridge {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  on(event: string, listener: (data: unknown) => void): () => void;
  receive(message: BridgeMessage): void;
}

export class BridgeCallError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeCallError";
  }
}

export function createNativeBridge(transport: NativeTransport, defaultTimeoutMs = 15_000): NativeBridge {
  let seq = 0;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  return {
    call<T>(method: string, params?: unknown, timeoutMs = defaultTimeoutMs): Promise<T> {
      const id = `req_${++seq}_${Date.now().toString(36)}`;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeCallError("timeout", `Native call ${method} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        try {
          transport.post({ id, method, params });
        } catch (err) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new BridgeCallError("bridge_error", err instanceof Error ? err.message : String(err)));
        }
      });
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
    receive(message) {
      if ("event" in message) {
        listeners.get(message.event)?.forEach((l) => l(message.data));
        return;
      }
      const p = pending.get(message.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(message.id);
      if (message.ok) p.resolve(message.result);
      else p.reject(new BridgeCallError(message.error.code, message.error.message));
    },
  };
}

interface WebKitWindow {
  webkit?: { messageHandlers?: Record<string, { postMessage(msg: unknown): void }> };
  __massefeltNative?: NativeBridge;
}

/** Detect the iOS shell's WKScriptMessageHandler named "massefelt" and install the receive hook. */
export function detectWebKitBridge(win: unknown = globalThis): NativeBridge | null {
  const w = win as WebKitWindow;
  const handler = w.webkit?.messageHandlers?.massefelt;
  if (!handler) return null;
  if (!w.__massefeltNative) {
    w.__massefeltNative = createNativeBridge({ post: (req) => handler.postMessage(req) });
  }
  return w.__massefeltNative;
}

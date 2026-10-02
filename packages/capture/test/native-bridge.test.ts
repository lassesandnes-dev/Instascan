import { describe, expect, it, vi } from "vitest";
import { CameraError, createNativeBridge, detectWebKitBridge, Insta360NativeAdapter, type BridgeRequest } from "../src";

function fakeShell(handler: (req: BridgeRequest) => { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } } | null) {
  const posted: BridgeRequest[] = [];
  const bridge = createNativeBridge(
    {
      post(req) {
        posted.push(req);
        const res = handler(req);
        if (res) queueMicrotask(() => bridge.receive({ id: req.id, ...res }));
      },
    },
    50,
  );
  return { bridge, posted };
}

describe("native bridge", () => {
  it("correlates responses, surfaces errors and times out", async () => {
    const { bridge } = fakeShell((req) =>
      req.method === "echo" ? { ok: true, result: req.params } : req.method === "fail" ? { ok: false, error: { code: "busy", message: "nope" } } : null,
    );
    await expect(bridge.call("echo", { a: 1 })).resolves.toEqual({ a: 1 });
    await expect(bridge.call("fail")).rejects.toMatchObject({ code: "busy" });
    await expect(bridge.call("silent")).rejects.toMatchObject({ code: "timeout" });
  });

  it("dispatches unsolicited events", () => {
    const { bridge } = fakeShell(() => null);
    const listener = vi.fn();
    bridge.on("camera.status", listener);
    bridge.receive({ event: "camera.status", data: { state: "connected" } });
    expect(listener).toHaveBeenCalledWith({ state: "connected" });
  });

  it("detects the WKWebView message handler", () => {
    const postMessage = vi.fn();
    const win = { webkit: { messageHandlers: { massefelt: { postMessage } } } };
    const bridge = detectWebKitBridge(win)!;
    void bridge.call("bridge.capabilities").catch(() => {});
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ method: "bridge.capabilities" }));
    expect(detectWebKitBridge({})).toBeNull();
  });
});

describe("Insta360NativeAdapter", () => {
  it("is unavailable without the native shell", async () => {
    const adapter = new Insta360NativeAdapter(null);
    expect(await adapter.isAvailable()).toBe(false);
    await expect(adapter.connect()).rejects.toBeInstanceOf(CameraError);
  });

  it("maps adapter calls to camera.* bridge methods", async () => {
    const { bridge, posted } = fakeShell((req) => {
      switch (req.method) {
        case "bridge.capabilities":
          return { ok: true, result: { cameras: ["insta360-x5"] } };
        case "camera.connect":
          return { ok: true, result: { kind: "insta360-x5", state: "connected", model: "Insta360 X5" } };
        case "camera.listFiles":
          return { ok: true, result: [{ id: "f1", name: "IMG_1.insp", projection: "dual-fisheye" }] };
        case "camera.startCapture":
          return { ok: false, error: { code: "busy", message: "Camera busy" } };
        default:
          return { ok: true, result: null };
      }
    });
    const adapter = new Insta360NativeAdapter(bridge);
    expect(await adapter.isAvailable()).toBe(true);
    expect(await adapter.connect()).toMatchObject({ state: "connected" });
    expect(await adapter.listFiles()).toEqual([expect.objectContaining({ projection: "dual-fisheye" })]);
    await expect(adapter.startCapture({ mode: "interval-photo", intervalSeconds: 2 })).rejects.toMatchObject({ code: "busy" });
    expect(posted.map((p) => p.method)).toEqual(["bridge.capabilities", "camera.connect", "camera.listFiles", "camera.startCapture"]);
  });
});

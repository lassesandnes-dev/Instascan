import { BridgeCallError, type NativeBridge } from "./native-bridge";
import { CameraError, type CameraAdapter, type CameraFile, type CameraPreview, type CameraStatus, type CaptureOptions } from "./types";

/**
 * Insta360 X5 adapter. All camera control happens in the native shell, which
 * embeds the Insta360 SDK; this class only speaks the bridge protocol
 * ("camera.*" methods) and knows nothing about the SDK.
 *
 * Note: X5 output is 360° imagery (dual-fisheye / equirectangular). A single
 * 360° image is not a point cloud; images feed the photogrammetry pipeline.
 */
export class Insta360NativeAdapter implements CameraAdapter {
  readonly kind = "insta360-x5" as const;

  constructor(private readonly bridge: NativeBridge | null) {}

  private async call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.bridge) throw new CameraError("not_available", "Insta360 X5 requires the Massefelt iOS app");
    try {
      return await this.bridge.call<T>(`camera.${method}`, params, timeoutMs);
    } catch (err) {
      if (err instanceof BridgeCallError) {
        const code = (["not_connected", "busy", "timeout", "permission_denied", "not_found"] as const).find((c) => c === err.code);
        throw new CameraError(code ?? "bridge_error", err.message);
      }
      throw err;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.bridge) return false;
    try {
      const caps = await this.bridge.call<{ cameras: string[] }>("bridge.capabilities", undefined, 2_000);
      return caps.cameras.includes("insta360-x5");
    } catch {
      return false;
    }
  }

  connect(): Promise<CameraStatus> {
    return this.call<CameraStatus>("connect", { kind: this.kind }, 30_000);
  }

  async disconnect(): Promise<void> {
    await this.call("disconnect");
  }

  getStatus(): Promise<CameraStatus> {
    return this.call<CameraStatus>("getStatus");
  }

  async startCapture(options: CaptureOptions): Promise<void> {
    await this.call("startCapture", options);
  }

  stopCapture(): Promise<CameraFile[]> {
    return this.call<CameraFile[]>("stopCapture");
  }

  listFiles(): Promise<CameraFile[]> {
    return this.call<CameraFile[]>("listFiles");
  }

  /**
   * The native shell downloads from the camera to app storage and returns a
   * URL served by the shell's URL scheme handler (e.g. massefelt-file://…).
   */
  async downloadFile(fileId: string): Promise<Blob> {
    const { url } = await this.call<{ url: string }>("downloadFile", { fileId }, 10 * 60_000);
    const res = await fetch(url);
    if (!res.ok) throw new CameraError("bridge_error", `Download failed (${res.status})`);
    return res.blob();
  }

  async getPreview(): Promise<CameraPreview> {
    const { url } = await this.call<{ url: string }>("getPreview");
    return { url };
  }
}

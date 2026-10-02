import { CameraError, type CameraAdapter, type CameraFile, type CameraPreview, type CameraStatus, type CaptureOptions } from "./types";

/**
 * Phone/laptop camera via getUserMedia. Captures perspective still frames
 * (photo or interval mode) for later photogrammetry upload.
 */
export class BrowserCameraAdapter implements CameraAdapter {
  readonly kind = "browser" as const;
  private stream: MediaStream | null = null;
  private files = new Map<string, { meta: CameraFile; blob: Blob }>();
  private sessionFiles: CameraFile[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: CameraStatus["state"] = "disconnected";

  constructor(private readonly media: MediaDevices | undefined = globalThis.navigator?.mediaDevices) {}

  async isAvailable(): Promise<boolean> {
    return typeof this.media?.getUserMedia === "function";
  }

  async connect(): Promise<CameraStatus> {
    if (!(await this.isAvailable())) throw new CameraError("not_available", "Camera API not available in this browser");
    this.state = "connecting";
    try {
      this.stream = await this.media!.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 4096 }, height: { ideal: 3072 } },
        audio: false,
      });
      this.state = "connected";
    } catch (err) {
      this.state = "error";
      const denied = err instanceof Error && err.name === "NotAllowedError";
      throw new CameraError(denied ? "permission_denied" : "not_available", err instanceof Error ? err.message : String(err));
    }
    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.state = "disconnected";
  }

  async getStatus(): Promise<CameraStatus> {
    const settings = this.stream?.getVideoTracks()[0]?.getSettings();
    return {
      kind: this.kind,
      state: this.state,
      model: this.stream?.getVideoTracks()[0]?.label,
      message: settings ? `${settings.width}×${settings.height}` : undefined,
    };
  }

  async startCapture(options: CaptureOptions): Promise<void> {
    if (!this.stream) throw new CameraError("not_connected", "Camera is not connected");
    if (options.mode === "video") throw new CameraError("unsupported", "Video capture is not supported by the browser adapter");
    if (this.timer) throw new CameraError("busy", "Capture already running");
    this.sessionFiles = [];
    this.state = "capturing";
    await this.grabFrame();
    if (options.mode === "interval-photo") {
      const ms = Math.max(0.5, options.intervalSeconds ?? 2) * 1000;
      this.timer = setInterval(() => void this.grabFrame(), ms);
    }
  }

  async stopCapture(): Promise<CameraFile[]> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.state === "capturing") this.state = "connected";
    return [...this.sessionFiles];
  }

  async listFiles(): Promise<CameraFile[]> {
    return [...this.files.values()].map((f) => f.meta);
  }

  async downloadFile(fileId: string): Promise<Blob> {
    const f = this.files.get(fileId);
    if (!f) throw new CameraError("not_found", `File not found: ${fileId}`);
    return f.blob;
  }

  async getPreview(): Promise<CameraPreview> {
    if (!this.stream) throw new CameraError("not_connected", "Camera is not connected");
    return { stream: this.stream };
  }

  private async grabFrame(): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    const { width = 1920, height = 1080 } = track.getSettings();
    const video = document.createElement("video");
    video.srcObject = this.stream;
    video.muted = true;
    await video.play();
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
    video.pause();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    const id = crypto.randomUUID();
    const meta: CameraFile = {
      id,
      name: `IMG_${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
      sizeBytes: blob.size,
      createdAt: new Date().toISOString(),
      mimeType: "image/jpeg",
      projection: "perspective",
    };
    this.files.set(id, { meta, blob });
    this.sessionFiles.push(meta);
  }
}

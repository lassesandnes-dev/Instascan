/**
 * Camera abstraction used by the web application. The web app only depends on
 * this interface — never on vendor SDKs (e.g. the Insta360 SDK), which live in
 * native shells and are reached through a message bridge.
 */
export type CameraKind = "browser" | "insta360-x5";

export type CameraConnectionState = "disconnected" | "connecting" | "connected" | "capturing" | "error";

export interface CameraStatus {
  kind: CameraKind;
  state: CameraConnectionState;
  model?: string;
  firmware?: string;
  batteryPercent?: number;
  storageFreeBytes?: number;
  message?: string;
}

export type CaptureMode = "photo" | "interval-photo" | "video";

export interface CaptureOptions {
  mode: CaptureMode;
  /** Seconds between photos for interval capture (photogrammetry walk-around). */
  intervalSeconds?: number;
  /** Request RAW/DNG where supported. */
  raw?: boolean;
}

export interface CameraFile {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  mimeType: string;
  /** "equirectangular" for 360° images; these are NOT point clouds and require photogrammetry. */
  projection: "perspective" | "equirectangular" | "dual-fisheye";
}

export interface CameraPreview {
  /** A MediaStream (browser) or an image/video URL served by the native shell. */
  stream?: MediaStream;
  url?: string;
}

export interface CameraAdapter {
  readonly kind: CameraKind;
  isAvailable(): Promise<boolean>;
  connect(): Promise<CameraStatus>;
  disconnect(): Promise<void>;
  getStatus(): Promise<CameraStatus>;
  startCapture(options: CaptureOptions): Promise<void>;
  /** Stops capture and returns the files produced by this capture session. */
  stopCapture(): Promise<CameraFile[]>;
  listFiles(): Promise<CameraFile[]>;
  downloadFile(fileId: string): Promise<Blob>;
  getPreview(): Promise<CameraPreview>;
}

export class CameraError extends Error {
  constructor(
    public readonly code:
      | "not_available"
      | "not_connected"
      | "permission_denied"
      | "busy"
      | "timeout"
      | "bridge_error"
      | "not_found"
      | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "CameraError";
  }
}

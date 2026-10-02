# Insta360 X5 integration architecture

## Goals and constraints

- Browser JavaScript **cannot** control an Insta360 X5 directly. Camera control (Wi-Fi/BLE pairing, capture, file transfer) goes through the Insta360 mobile SDK, which runs only in a native app.
- The web application must stay **vendor-agnostic**. It talks to the `CameraAdapter` interface (`packages/capture`) and never imports or references Insta360 SDK types.
- The X5 produces **360° imagery** (dual-fisheye `.insp`/`.dng`, or stitched equirectangular). **One 360° image is not a point cloud.** Images feed the photogrammetry pipeline ([photogrammetry-pipeline.md](photogrammetry-pipeline.md)), which reconstructs geometry from many overlapping views.

## Components

```
┌──────────────────────── iOS app "Massefelt" (Swift) ────────────────────────┐
│                                                                              │
│  WKWebView ── loads https://app.massefelt… (the same Next.js web app)        │
│     │  JS: window.webkit.messageHandlers.massefelt.postMessage({id,method,…})│
│     ▼                                                                        │
│  BridgeController : WKScriptMessageHandler                                   │
│     │  dispatch "camera.*" → CameraService                                   │
│     │  reply  → webView.evaluateJavaScript("__massefeltNative.receive(…)")   │
│     ▼                                                                        │
│  CameraService (protocol)                                                    │
│     ├─ Insta360CameraService  ── Insta360 SDK (INSCameraSDK / INSCoreMedia)  │
│     └─ (future) other native cameras                                         │
│                                                                              │
│  LocalFileSchemeHandler : WKURLSchemeHandler  (massefelt-file://<token>)     │
│     serves downloaded camera files to the web view without base64 copies     │
└──────────────────────────────────────────────────────────────────────────────┘
```

On the web side:

```ts
import { detectWebKitBridge, Insta360NativeAdapter, BrowserCameraAdapter } from "@massefelt/capture";

const bridge = detectWebKitBridge();            // null in a normal browser
const camera = bridge ? new Insta360NativeAdapter(bridge) : new BrowserCameraAdapter();
if (await camera.isAvailable()) { await camera.connect(); /* … */ }
```

## Bridge protocol (v1)

All messages are JSON.

**Request (web → native)**, through `window.webkit.messageHandlers.massefelt.postMessage`:

```json
{ "id": "req_12_lx3k", "method": "camera.startCapture", "params": { "mode": "interval-photo", "intervalSeconds": 2 } }
```

**Response (native → web)**, by calling `window.__massefeltNative.receive(message)`:

```json
{ "id": "req_12_lx3k", "ok": true, "result": null }
{ "id": "req_12_lx3k", "ok": false, "error": { "code": "busy", "message": "Camera is recording" } }
```

**Events (native → web, unsolicited):**

```json
{ "event": "camera.status", "data": { "kind": "insta360-x5", "state": "connected", "batteryPercent": 78 } }
{ "event": "camera.captureProgress", "data": { "filesCaptured": 14 } }
```

| Method | Params | Result |
| --- | --- | --- |
| `bridge.capabilities` | – | `{ protocolVersion: 1, cameras: ["insta360-x5"] }` |
| `camera.connect` | `{ kind }` | `CameraStatus` |
| `camera.disconnect` | – | `null` |
| `camera.getStatus` | – | `CameraStatus` |
| `camera.startCapture` | `CaptureOptions` (`photo`, `interval-photo`, `video`; `raw`) | `null` |
| `camera.stopCapture` | – | `CameraFile[]` produced in this session |
| `camera.listFiles` | – | `CameraFile[]` (with `projection`: `dual-fisheye` or `equirectangular`) |
| `camera.downloadFile` | `{ fileId }` | `{ url }`: a `massefelt-file://` URL served by the scheme handler |
| `camera.getPreview` | – | `{ url }`: an MJPEG/HLS preview URL from the shell |

Error codes: `not_connected`, `busy`, `timeout`, `permission_denied`, `not_found`, `bridge_error`. These map onto `CameraError` in TypeScript.

## Swift sketch

```swift
final class BridgeController: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    let camera: CameraService                       // protocol; Insta360CameraService implements it

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only accept messages from our own origin.
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == AppConfig.webHost,
              let body = message.body as? [String: Any],
              let id = body["id"] as? String, let method = body["method"] as? String else { return }
        Task { @MainActor in
            do {
                let result = try await dispatch(method, params: body["params"])
                reply(["id": id, "ok": true, "result": result ?? NSNull()])
            } catch let e as CameraServiceError {
                reply(["id": id, "ok": false, "error": ["code": e.code, "message": e.localizedDescription]])
            } catch {
                reply(["id": id, "ok": false, "error": ["code": "bridge_error", "message": "\(error)"]])
            }
        }
    }

    private func reply(_ message: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: message)
        let json = String(data: data, encoding: .utf8)!
        webView?.evaluateJavaScript("window.__massefeltNative && window.__massefeltNative.receive(\(json))")
    }
}

// Registration
let ucc = WKUserContentController()
ucc.add(bridgeController, name: "massefelt")         // → window.webkit.messageHandlers.massefelt
config.setURLSchemeHandler(LocalFileSchemeHandler(), forURLScheme: "massefelt-file")
```

`Insta360CameraService` wraps the SDK: connection management, capture-mode configuration (interval photo is recommended for photogrammetry walk-arounds), file listing, and file download to the app's sandbox. Downloads are exposed through one-time tokens in `massefelt-file://` URLs. The same structure works for an Android `WebView` with `addJavascriptInterface` and `WebViewAssetLoader`.

## Security

- Accept bridge messages only from the main frame and the app's own origin. Reject everything else.
- Expose only the `camera.*` and `bridge.*` methods. No generic file-system or shell access.
- `massefelt-file://` tokens are random, single-use and scoped to files the user captured.
- Uploads from the shell to the platform go through the normal authenticated upload API. The native layer holds no platform secrets beyond the user session.

## Data flow to the platform

1. Capture an interval-photo walk-around with the X5. Optionally add GNSS or ground control points.
2. The web app calls `downloadFile` for each image and uploads it to `Scan` as an `IMAGE_SET` asset (planned upload endpoint), keeping the original files and EXIF.
3. The server enqueues `images.preprocess`. The worker reprojects dual-fisheye or equirectangular frames into perspective views and extracts EXIF/GNSS.
4. The worker runs `photogrammetry.reconstruct`, then `pointcloud.import.engine`, then `surface.build`. Each output is a new `Asset` whose `parentAssetId` points to the image set.
5. Without control points the result is in an **arbitrary local frame**: `crs = null`, scale possibly unknown. It is shown as such and never labelled with a real CRS.

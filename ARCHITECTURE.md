# Architecture

## 1. Principles

1. **Geometry is authoritative and deterministic.** All numbers (distances, statistics, and later volumes and sections) come from `@massefelt/geometry`, which is pure TypeScript and covered by unit tests. Python implementations in the worker will be validated against it. Results record `engineVersion`.
2. **AI orchestrates, it does not compute.** Models never receive raw point clouds or coordinates in prompts. They call **tools**. A tool validates its arguments, is scoped server-side to one project, runs the engine or reads the database, and returns compact JSON. Every call is audited.
3. **No silent coordinate conversion.** Coordinates are stored exactly as received, together with the declared CRS and vertical datum. Unknown stays unknown (`null`) and the UI says so. Future reprojection will be an explicit operation that produces a new asset with lineage.
4. **Provenance everywhere.** Every dataset is an `Asset` that records the original filename, source, acquisition date, CRS, vertical datum, processing method and version, units, parent asset and timestamp.
5. **Heavy work happens off the request path.** Long-running processing runs as `ProcessingJob`s in an isolated worker. Only small, deterministic work runs inline (milestone 1 XYZ import), and it is still recorded as a job.
6. **Vendor neutrality.** AI providers, object storage, the photogrammetry engine and the camera hardware each sit behind an interface.
7. **No fake features.** Anything unimplemented is labelled "Planned". Planned AI tools are not registered, so a model cannot "call" them and invent a result.

## 2. Monorepo and dependency graph

```
apps/web ──► ai ──► tools ──► geometry ──► shared
   │          │       ▲
   │          └───────┤
   ├──► database ─────┘ (implements tools' ProjectDataPort)
   ├──► storage
   └──► geometry (client-side preview + MFPC decode)

packages/mcp ──► tools, database
packages/capture (browser-only; no server deps)
apps/worker (Python) ──► PostgreSQL ProcessingJob table, object storage
```

Workspace packages are consumed as TypeScript source (`transpilePackages` in Next.js, `tsx` for the MCP CLI). Each package has its own strict `tsc` typecheck.

## 3. Data model (Prisma, `packages/database/prisma/schema.prisma`)

| Concept | Model | Notes |
| --- | --- | --- |
| User / Organization | `User`, `Organization`, `Membership` | Projects belong to organizations. Access is checked through membership in every service call. |
| Project | `Project` | Declared default CRS, vertical datum and units. |
| Scan | `Scan` | One capture or import session, with status `UPLOADED → PROCESSING → READY / FAILED`. |
| ScanFile | `ScanFile` | Original upload, stored verbatim with its SHA-256. Never executed. |
| Asset (provenance root) | `Asset` | `kind` = `POINT_CLOUD`, `MESH`, `SURFACE` or `IMAGE_SET`. Holds all provenance fields, `parentAssetId` (lineage), `sourceFileId` and `storageKey`. |
| PointCloud / Mesh / Surface | 1:1 detail tables on `Asset` | Bounding box, local origin, statistics, counts. |
| ProcessingJob | `ProcessingJob` | Also the durable job queue (§6). |
| Measurement | `Measurement` | World-coordinate vertices, primary `value`, full engine `result`, CRS, units, `engineVersion`. |
| CrossSection, VolumeCalculation | | Schema reserved (planned). |
| SceneObject | `SceneObject` | `type`, `dimensions` (metres), position, rotation (radians), scale, `source`, metadata, CRS. |
| Export | `Export` | Planned PDF/DXF/IFC/CSV/LandXML outputs. |
| AIConversation, AIMessage, AIToolCall | | Conversation history (text turns) and the audit log of every tool call (arguments, result, error, duration). |

### Scene objects

`@massefelt/geometry/scene-objects.ts` defines Zod schemas for `stone-step`, `pipe`, `manhole`, `box` and `staircase`, with dimensions in metres and positive-value validation. The example `StoneStep` (1.2 × 0.4 × 0.15 m) is included and tested. The planned `createStaircase` tool will take a start and end point on terrain, sample the surface profile, and emit `stone-step` objects that respect the rise/run limits.

## 4. Coordinates, precision and the viewer

- **Survey data is Z-up.** The viewer sets `camera.up = +Z` and rotates the grid into the XY plane.
- **Large coordinates.** Projected coordinates (UTM northings ≈ 6.6 million m) cannot be stored in GPU Float32 at millimetre precision. The engine keeps Float64 throughout. The web representation (**MFPC v1**, `geometry/encoding.ts`) stores Float32 positions *relative to a Float64 local origin*. The viewer uses the first cloud's origin as the scene origin and offsets other clouds. Picks are converted back to world coordinates in Float64 and **snap to the actual scanned point**, not the ray position.
- `PointCloudViewer` (`apps/web/src/viewer`) is framework-agnostic Three.js. React only hosts it. Planned extension points: an orthographic top view (camera swap), clipping/section planes (`renderer.clippingPlanes`), polygon selection (screen-space lasso + point-in-polygon on the engine side), mesh and imagery layers, and object placement gizmos.
- Large clouds (planned): the worker will generate a tiled level-of-detail format (for example COPC or 3D Tiles) under the same `Asset` lineage, replacing the single MFPC buffer.

## 5. Tool layer and AI

```
Browser (AI panel) ──POST /api/ai/chat {projectId, provider, message, selection}──► Next.js route
   ▲                                                                                 │
   │ NDJSON events: conversation, text, tool_call, tool_result, done, error          ▼
   │                                                           services/assistant.chat()
   │                                       • auth + project membership
   │                                       • selection IDs verified against the project
   │                                       • history loaded from DB (client cannot inject turns)
   │                                                                 │
   │                                                     runAssistant() (packages/ai)
   │                                                                 │
   │                                AIProvider.run(system, history, toolSpecs, executeTool)
   │                                   ├─ OpenAIProvider   (Responses API stream, function calls)
   │                                   └─ AnthropicProvider (Messages API stream, tool_use)
   │                                                                 │ executeTool(name, args)
   │                                                                 ▼
   └──────────────────────────────────────────────── ToolRegistry.execute (packages/tools)
                                                     • Zod validation (strict, unknown keys rejected)
                                                     • ToolContext{projectId, userId, selection, data}
                                                     • geometry engine / ProjectDataPort (Prisma)
                                                     • audit → AIToolCall table, structured log
```

- **Provider abstraction.** `AIProvider.run()` owns each vendor's native message format and tool loop. Tool execution is always delegated back to the registry. Adding a vendor means implementing one class.
- **OpenAI.** Uses the Responses API (`client.responses.stream`) with `store: false` and `include: ["reasoning.encrypted_content"]`, so reasoning items can be round-tripped without server-side storage. Function results go back as `function_call_output` items.
- **Anthropic.** Uses the Messages API (`client.beta.messages.stream`) with adaptive thinking (the model default), `output_config.effort`, server-side refusal fallback (`fallbacks: "default"`) and `eager_input_streaming` on tools. Inputs are validated by the registry anyway. All tool results from one turn go back in a single user message.
- **Context.** The system prompt contains the project name and ID, the selected scan, measurement and objects, and measurement names, but **no values**. The model must call `getMeasurement`, `getStatistics` and similar tools.
- **Tools in milestone 1:** `getProject`, `getSelection`, `listScans`, `getScanMetadata`, `getBoundingBox`, `getStatistics`, `listMeasurements`, `getMeasurement`, `measureDistance`, `measureElevationDifference`.
- **Planned tools (not registered):** `calculateVolume`, `createCrossSection`, `compareSurfaces`, `placeObject`, `createStaircase`, `renderView`, `exportDXF`, `exportIFC`, `createReport`. Mutating tools will be marked `readOnly: false` and will require user confirmation in the UI.
- **MCP.** `packages/mcp` exposes the same `ToolRegistry.specs()` and `execute()` over the Model Context Protocol, so external clients (Claude, ChatGPT and other MCP hosts) get identical tools and guarantees.
- **Limits.** `AI_MAX_TOOL_ROUNDS`, `AI_MAX_MESSAGE_CHARS`, a 20k-character cap on tool results returned to a model, and a history window of 30 messages.

## 6. Processing jobs and the worker

- `ProcessingJob` is the queue. The Python worker claims rows with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, so many workers can run safely. Failures retry with exponential backoff up to `maxAttempts`. `PermanentJobError` fails immediately. Stale locks are requeued.
- **Why not BullMQ/Redis?** BullMQ is Node-only, and the heavy workers are Python. A Postgres queue gives transactional enqueueing (the job and the domain row are written in one transaction), has no extra infrastructure, and is enough for photogrammetry-scale jobs (minutes to hours, not thousands per second). The `enqueueProcessingJob` helper isolates callers, so a Redis-backed transport could replace it if throughput ever requires.
- **Inline vs worker.** XYZ import (milestone 1) is light and deterministic, so it runs inline with `executor = "inline"` and is still recorded as a job with engine and version. LAS/E57, photogrammetry, meshing and surfaces will be `executor = "worker"` jobs.
- **Isolation.** In Docker the worker has no published ports, a read-only root filesystem, a tmpfs `/tmp` and `no-new-privileges`. Uploaded files are treated as data only. They are never executed or interpreted by a shell.
- The photogrammetry pipeline and engine interface are in [docs/photogrammetry-pipeline.md](docs/photogrammetry-pipeline.md).

## 7. Storage

`ObjectStorage` (`put`, `get`, `exists`, `delete`) has two drivers: `LocalFileStorage` (development) and `S3Storage` (AWS S3, MinIO, R2). Keys are generated by the server (`projects/{projectId}/scans/{scanId}/original/{uuid}.xyz`, `…/assets/{assetId}.mfpc`) and validated against traversal. User filenames are sanitised and stored only as metadata.

## 8. Security

| Concern | Measure |
| --- | --- |
| API secrets | Read only in server code (`server-only` modules). `/api/ai/providers` returns booleans only. |
| Authorization | Every service resolves the project through organization membership. Unknown and foreign IDs both return 404. Tools receive `projectId` from the server, never from the model. |
| Uploads | Extension allow-list, planned formats rejected (415), NUL-byte and UTF-8 checks, configurable `UPLOAD_MAX_BYTES` and `UPLOAD_MAX_POINTS`, files written with mode 0640, never executed. |
| AI tool arguments | Strict Zod schemas (unknown keys rejected, ID regex, finite numbers). Invalid JSON is returned to the model as an error. Tool results are size-capped. |
| AI capabilities | Only registered, read-only tools. No shell, SQL or arbitrary database access. Planned mutating tools will require confirmation. |
| Logging | Structured JSON logs for tool calls and processing. `AIToolCall` audit table. Job status, error and engine version in `ProcessingJob`. |
| Auth | `AUTH_MODE=dev` is refused in production unless explicitly overridden. Supabase JWT verification is planned (map `sub` → `User.authSubject`). |
| HTTP | `X-Content-Type-Options`, `X-Frame-Options: DENY` and `Referrer-Policy` headers. |

## 9. Camera capture

The `CameraAdapter` interface (`packages/capture`) has two implementations. `BrowserCameraAdapter` uses `getUserMedia`. `Insta360NativeAdapter` uses a message bridge to a future iOS shell that embeds the Insta360 SDK. The web app never sees SDK details. See [docs/insta360-architecture.md](docs/insta360-architecture.md).

## 10. Roadmap (next steps)

1. **Surfaces and volumes.** Ground-filter and grid (DEM) or TIN from a point cloud in the worker. Then the `calculateVolume` tool (surface-to-plane and surface-to-surface, cut/fill, stockpile with a base polygon), polygon drawing in the viewer, and a cross-section tool.
2. **More formats via the worker.** LAS/LAZ and E57 through PDAL, with a tiled LOD output for large clouds and job-progress UI.
3. **Production auth and deployment.** Supabase Auth, multi-organization UI, S3 in all environments, and a hosted MCP endpoint with per-user authorization.

# Massefelt

A web platform for construction-site 3D scanning: point clouds, terrain analysis, earthwork calculations and AI-assisted workflows.

"Massefelt" (volume calculation) is one module. The platform is built as a general 3D data platform: projects, scans, processed assets with full provenance, a deterministic geometry engine, and an AI assistant that can reach project data **only through validated tools**.

> **Status: Milestone 1 (vertical slice).** Upload an XYZ/CSV point file, view it in 3D, measure and save distances, and ask the AI assistant about scans and measurements. Everything else is designed and marked **Planned** in the UI and docs. See [What works](#what-works-milestone-1) and [Planned](#planned).

---

## Quick start (local)

Requirements: Node.js ≥ 22, pnpm 10 (`corepack enable`), PostgreSQL 16, and Python ≥ 3.11 (only for the worker).

```bash
# 1. Infrastructure: use Docker…
docker compose up -d postgres minio minio-init
#    …or a local PostgreSQL with databases `massefelt` and `massefelt_test`
#    owned by user massefelt/massefelt (see docker/postgres/init-test-db.sql).

# 2. Install and configure
pnpm install                      # also generates the Prisma client
cp .env.example .env              # add OPENAI_API_KEY and/or ANTHROPIC_API_KEY for the assistant

# 3. Database
pnpm db:migrate

# 4. Run the web app
pnpm dev                          # http://localhost:3000
```

Then create a project, click **Upload scan**, and pick `samples/terrain-stockpile-epsg25832.xyz` (22,500 synthetic points in EPSG:25832 / NN2000).

### Worker (optional for milestone 1)

```bash
cd apps/worker
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
set -a; . ../../.env; set +a
.venv/bin/python -m massefelt_worker
```

The worker claims `ProcessingJob` rows with `executor = 'worker'`. In milestone 1 it runs `system.healthcheck`, plus `photogrammetry.reconstruct`, which fails with a clear error until a photogrammetry engine is configured. XYZ import runs inline in the web process (see ARCHITECTURE.md).

### Everything in containers

```bash
docker compose --profile app up --build
```

This uses MinIO as S3 storage and the development auth mode. Do not expose this setup publicly.

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm lint` | ESLint (TypeScript, Next.js, React hooks rules) |
| `pnpm typecheck` | `tsc --noEmit` for every package + root configs |
| `pnpm test` | Unit tests (Vitest): geometry, tools, AI providers, MCP, storage, capture |
| `pnpm test:integration` | API + PostgreSQL integration tests (uses `TEST_DATABASE_URL`, truncates it) |
| `pnpm test:worker` | Python worker tests (queue tests run when `TEST_DATABASE_URL` is set) |
| `pnpm test:e2e` | Playwright browser smoke test (needs `pnpm dev` running; set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled Chromium) |
| `pnpm db:migrate` / `pnpm db:migrate:dev` | Apply migrations / create a new migration |
| `pnpm mcp` | MCP stdio server exposing the tool layer (`MASSEFELT_PROJECT_ID=<id>`) |
| `pnpm check` | lint + typecheck + unit tests |

---

## Repository layout

```
apps/
  web/            Next.js 16 app: UI, route handlers, server services, Three.js viewer
  worker/         Python background worker (Postgres-backed job queue, photogrammetry interface)
packages/
  shared/         Types, provenance schema, input-format registry, errors, logger
  geometry/       Authoritative geometry engine (parsing, statistics, distances, encoding, scene objects)
  database/       Prisma schema, migrations, client, Prisma-backed tool data port, job enqueueing
  storage/        Object storage abstraction (local filesystem, S3-compatible)
  tools/          Deterministic, validated, project-scoped tool layer used by AI and MCP
  ai/             AIProvider abstraction: OpenAI (Responses API) and Anthropic (Messages API)
  mcp/            MCP server exposing the same tools
  capture/        CameraAdapter abstraction (browser camera, Insta360 X5 via native bridge)
docs/             Insta360 and photogrammetry design documents
samples/          Sample point data and its generator
e2e/              Playwright smoke test
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

---

## What works (milestone 1)

1. Open the app (development auth provisions a local user and organization).
2. Create a project with an optional default CRS and vertical datum.
3. Open the full-screen project workspace: toolbar, project tree, 3D view, AI panel and status bar.
4. Upload an XYZ/CSV/TXT/PTS point file. The upload is validated (extension, text-only, UTF-8, size limit, point limit).
5. The file is parsed (x,y,z with optional RGB or intensity, header aliases, comments, any delimiter).
6. The scan's metadata and provenance are saved: original file (with SHA-256), asset with CRS, vertical datum, units, processing method and version, and a `ProcessingJob` record.
7. The points are shown in a Three.js scene. The camera is Z-up, and points are coloured by RGB or by an elevation ramp.
8. Orbit freely: full 360° azimuth and the full polar range.
9. Zoom (towards the cursor) and pan.
10. Reset the camera to fit the data.
11. Select two points with **Measure distance**. Picks snap to real scanned points and show true 3D distance.
12. The panel shows ΔX, ΔY, ΔZ, horizontal distance and slope.
13. Save the measurement. The server recomputes every value with the geometry engine.
14. The AI side panel lets you switch between OpenAI and Claude. It shows "not configured" when a key is missing.
15. "What scans are available in this project?" → the assistant calls the `listScans` tool.
16. Answers come from tool results, and every call is written to the `AIToolCall` audit table.
17. "What is the distance of the selected measurement?" → the assistant calls `getMeasurement`, which uses the measurement selected in the viewer.
18. The value comes from the saved measurement, not from the prompt. The system prompt contains only IDs and names.
19. Lint, typecheck, unit, integration, worker and e2e tests pass.

Also included: point-size slider, grid and axes toggles, scan visibility, scan and measurement deletion, scan metadata/provenance panel, cursor coordinates in the status bar, and the MCP server.

## Planned

These are designed but not implemented. The UI and docs mark them **Planned**, and planned AI tools are deliberately not registered:

- LAS/LAZ, E57, PLY, OBJ, GLB/glTF, GeoTIFF and ASCII-grid import (run in the worker)
- Surfaces (TIN/DEM), cut/fill and stockpile volumes, cross sections, surface comparison
- Orthographic top view, clipping/section planes, polygon selection, classification, mesh display, imagery and map background
- Object placement (the data model is ready) and the automatic stone-staircase generator
- PDF/DXF/IFC exports and reports
- Photogrammetry engines (the interface and job pipeline are ready), the Insta360 X5 iOS shell, and Høydedata.no import
- Supabase authentication (`AUTH_MODE=supabase` currently fails closed)

## AI providers

Keys are read **only on the server** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). The browser only learns whether each provider is configured.

| Provider | API | Default model (override with env) |
| --- | --- | --- |
| OpenAI | Responses API, streaming, `store: false` | `OPENAI_MODEL=gpt-5.5` |
| Claude | Messages API, streaming, server-side refusal fallback (`ANTHROPIC_FALLBACKS=off` to disable) | `ANTHROPIC_MODEL=claude-opus-5-5`, `ANTHROPIC_EFFORT=medium` |

## MCP

```bash
MASSEFELT_PROJECT_ID=<project id> pnpm mcp
```

This starts a stdio MCP server with the same tools, validation and project scoping as the in-app assistant. It is for local development: a production MCP endpoint must sit behind authentication that resolves the user and authorises the project.

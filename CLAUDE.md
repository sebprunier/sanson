# Sanson — Claude guidance

## Project

Sanson is an open source geospatial server built with Node.js 24 + TypeScript + Fastify, backed by PostgreSQL + PostGIS. It exposes geographic data via OGC API — Features compliant REST APIs.

Full specifications are in [`SPECS.md`](./SPECS.md). Read it before making significant decisions.

## Tech stack

- **Runtime**: Node.js 24 (see `.nvmrc`)
- **Package manager**: pnpm with workspaces
- **Language**: TypeScript (strict mode, `moduleResolution: Bundler`)
- **HTTP framework**: Fastify 5
- **Database**: PostgreSQL 16 + PostGIS 3.4, accessed via `pg` (raw SQL — no ORM)
- **Admin UI**: React 19 + Vite 8 + Tailwind CSS 4 + MapLibre GL JS
- **Tests**: vitest + Testcontainers (real PostGIS — no DB mocking)
- **Linting**: ESLint + Prettier, enforced on commit via Husky + lint-staged
- **CI**: GitHub Actions (lint, typecheck, tests)

### Not yet implemented (planned)

- **Job queue**: pg-boss (PostgreSQL-based, no Redis or external queue)
- **Geo ingestion**: `ogr2ogr` CLI + PostgreSQL `COPY` for Shapefile support and large volumes

## Monorepo layout

```
packages/api/     Fastify server — OGC API + admin routes
apps/admin/       React + Tailwind CSS + MapLibre GL admin UI
docker/           Docker Compose for local PostgreSQL + PostGIS
scripts/          SQL init scripts
data/             Test datasets (GeoJSON, Shapefile)
```

Planned but not yet created: `packages/core/` (shared types, CQL2 parser), `packages/worker/` (ingestion workers).

## Running things

```bash
nvm use                                     # Node 24
pnpm install                                # install deps
docker compose -f docker/compose.yml up -d  # start DB (port 5433)
pnpm dev                                    # API dev server (port 3000)
pnpm --filter @sanson/admin dev             # admin UI dev server (port 5173)
pnpm test                                   # run all tests (API unit + integration)
pnpm --filter @sanson/api test              # run api tests only
pnpm --filter @sanson/admin e2e             # run E2E tests (needs API + UI running)
pnpm --filter @sanson/admin e2e:headed      # same, with visible browser
```

## Coding conventions

- **English** everywhere — code, comments, commit messages, docs
- **Raw SQL** — use `pg` Pool directly, no ORM, no query builder
- **Fastify patterns** — define routes in separate files under `src/routes/`, register them in `app.ts`
- **`buildApp(db: Pool)`** — app factory takes a Pool as argument, enabling clean testing without mocks
- **No `any`** — TypeScript strict mode is enforced
- Imports use `.js` extension only when `moduleResolution: NodeNext` requires it — current config is `Bundler`, so no extension needed

## Testing conventions

- **No database mocks** — integration tests use real PostGIS via Testcontainers
- Tests that don't touch the DB use a dummy `{} as Pool` — be explicit about this with a comment
- `beforeAll` / `afterAll` for container lifecycle — one container per `describe` block
- `hookTimeout: 120_000` in vitest config — container pull can be slow on first run
- Test file structure mirrors source: `test/routes/health.test.ts` for `src/routes/health.ts`

## E2E testing conventions

- **Playwright** with Chromium, test files in `apps/admin/e2e/`
- **WebGL in headless** — Chromium launch args `--use-gl=angle --use-angle=swiftshader` (required for MapLibre GL)
- `fullyParallel: false` — tests run sequentially within each file
- `reuseExistingServer: true` — E2E tests use already-running API + UI dev servers
- Use `{ exact: true }` on `getByRole`/`getByText` when MapLibre buttons may conflict (e.g., `{ name: 'Map', exact: true }`)

## Key architectural decisions

- **OGC API Features URLs** — collections are identified as `{workspaceName}:{layerName}` (e.g., `default:centrales`)
- **Default workspace** — always exists, created in `scripts/init.sql`
- **Synchronous GeoJSON import** — direct parsing + insert via `ST_GeomFromGeoJSON`. Each import is recorded in `sanson_import_history`. Async worker with pg-boss planned for later.
- **CQL2 Text parser** — recursive descent parser in `packages/api/src/cql2.ts`, outputs parameterized SQL. Validates column names against `information_schema.columns`.
- **OGC datetime filter** — `?datetime=` supports instant, interval, and open-ended bounds (`..`). Requires `datetime_column` to be configured on the layer.
- **Lat/lon/radius shortcuts** — non-standard convenience params: `?lat=&lon=` for point intersection, `?lat=&lon=&radius=` for radius search (meters, via `::geography` cast). Combinable with all other filters.
- **OGC pagination** — `first`/`last`/`next`/`prev` links in body + `Link` header + `X-Total-Count`. All query params (bbox, datetime, lat/lon/radius, filter) are preserved in pagination links.
- **Vector tiles (MVT)** — `GET /collections/:id/tiles/:z/:x/:y.pbf`. Uses `ST_AsMVT` + `ST_AsMVTGeom` with extent=4096, buffer=256. Properties cast to text. Returns `application/vnd.mapbox-vector-tile` with 1h cache. Empty tiles return 204.
- **WGS84 (EPSG:4326) by default** for API output
- **Table prefix `sanson_`** for metadata tables (workspaces, layers, import history) — no dedicated schema for now, revisit later if needed
- **Vite proxy** — admin UI dev server on port 5173 proxies `/api`, `/collections`, `/conformance`, `/health` to API on port 3000

## Out of scope — do not add

- Authentication / authorization
- Multi-environment management
- WMS, WFS, WCS, WPS protocols
- ORMs or query builders
- Redis or external message queues
- Raster tile generation

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

- **Geo ingestion**: `ogr2ogr` CLI + PostgreSQL `COPY` for Shapefile support and large volumes

## Monorepo layout

```
packages/api/     Fastify server — OGC API + admin routes
packages/worker/  pg-boss job queue + async ingestion workers
apps/admin/       React + Tailwind CSS + MapLibre GL admin UI
docker/           Docker Compose for local PostgreSQL + PostGIS
scripts/          SQL init scripts
data/             Test datasets (GeoJSON, Shapefile)
```

Planned but not yet created: `packages/core/` (shared types, CQL2 parser).

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
- **`buildApp(db: Pool, options?)`** — app factory takes a Pool + optional config (including `boss` for pg-boss), enabling clean testing without mocks
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
- **Async GeoJSON import** — API saves file to `UPLOAD_DIR`, creates `sanson_import_history` row, queues a pg-boss job, returns `202 Accepted`. Worker processes the file: parses GeoJSON (with gzip decompression if needed), creates table with `ST_GeomFromGeoJSON`, inserts in batches of 500, updates progress in DB. Supports `.geojson`, `.json`, `.geojson.gz`, `.gz`.
- **CSV import** — Same async pipeline as GeoJSON. Auto-detects separator (`;`, `,`, `\t`) from header line and geo columns from common names (`longitude`/`lon`/`lng`/`x`/`x_wgs84`/etc.) with priority-based matching (explicit WGS84 names first, generic last; projected names like `x_l93` are NOT auto-detected). Optional explicit params: `separator`, `longitude`, `latitude`. Creates `MultiPoint` geometry via `ST_MakePoint`. Strips UTF-8 BOM, infers column types from first 100 rows, skips rows with invalid coordinates. Reserved column names (`id`, `geom`) are prefixed with `_`.
- **Re-import safety** — when importing into an existing layer (same workspace + name), the data table is dropped and recreated. This ensures no stale data accumulates from previous imports.
- **pg-boss job queue** — PostgreSQL-based async workers via pg-boss v10. `NODE_MODE` env var controls startup: `api` (HTTP only), `worker` (pg-boss only), `all` (both, default). Requires explicit `createQueue()` before `send()`/`work()`. Worker handler receives an array: `async ([job]) =>`.
- **Geometry type promotion** — always promotes to Multi variant (`MultiPolygon`, `MultiLineString`, etc.) via `toMultiType()` and wraps inserts with `ST_Multi()` to handle mixed single/multi geometries in the same GeoJSON file.
- **Layer deletion** — `sanson_import_history.layer_id` FK uses `ON DELETE CASCADE`. DELETE handler also drops the associated `data_*` PostGIS table.
- **CQL2 Text parser** — recursive descent parser in `packages/api/src/cql2.ts`, outputs parameterized SQL. Validates column names against `information_schema.columns`. Supports: comparison, logic (AND/OR/NOT), text (LIKE/ILIKE/NOT LIKE/NOT ILIKE), null (IS NULL/IS NOT NULL), list (IN/NOT IN), range (BETWEEN/NOT BETWEEN), and all CQL2 spatial functions (S_INTERSECTS, S_WITHIN, S_CONTAINS, S_TOUCHES, S_CROSSES, S_OVERLAPS, S_EQUALS, S_DISJOINT).
- **OGC datetime filter** — `?datetime=` supports instant, interval, and open-ended bounds (`..`). Requires `datetime_column` to be configured on the layer.
- **Lat/lon/radius shortcuts** — non-standard convenience params: `?lat=&lon=` for point intersection, `?lat=&lon=&radius=` for radius search (meters, via `::geography` cast). Combinable with all other filters.
- **OGC pagination** — `first`/`last`/`next`/`prev` links in body + `Link` header + `X-Total-Count`. All query params (bbox, datetime, lat/lon/radius, filter) are preserved in pagination links.
- **Vector tiles (MVT)** — `GET /collections/:id/tiles/:z/:x/:y.pbf`. Uses `ST_AsMVT` + `ST_AsMVTGeom` with extent=4096, buffer=256. Properties cast to text. Returns `application/vnd.mapbox-vector-tile` with 1h cache. Empty tiles return 204.
- **Exposed fields** — `exposed_fields` JSONB column on `sanson_layers`. When null, all columns are exposed (backward compatible). When set, only listed columns appear in features, queryables, MVT tiles, and export. Each entry has `source` and optional `alias`. Uses `jsonb_build_object()` for selective property building. Helper functions: `buildPropertiesExpr()` for SQL property expression, `getExposedColumns()` for queryables and MVT.
- **Layer style / legend** — `style` JSONB column on `sanson_layers`. Three types: `single` (one color), `categorized` (unique values → colors via MapLibre `match`), `graduated` (numeric ranges → colors via MapLibre `step` with `to-number`). Auto-classification endpoint `GET /api/admin/layers/:id/classify` computes distinct values or quantile breakpoints from PostgreSQL. OGC endpoint `GET /collections/:id/style` exposes the config. Frontend converts style config to MapLibre paint expressions; legend is a DOM overlay.
- **GeoJSON export** — `GET /api/admin/layers/:id/export`. Streams full layer as GeoJSON FeatureCollection with `Content-Disposition` header. Respects `exposed_fields` filtering.
- **Dynamic layer update** — PUT handler uses dynamic SET clause builder (`addField()`) that only includes provided fields, avoiding null/undefined ambiguity for nullable columns (description, attribution, datetime_column, exposed_fields, style).
- **CRS by Reference** — `?crs=` param on items/feature endpoints for output reprojection, `?bbox-crs=` for bbox coordinate system. `Content-Crs` response header. Supported CRS per collection: CRS84, EPSG:4326, EPSG:3857, EPSG:2154, plus the layer's native SRID. CRS utilities in `packages/api/src/crs.ts`.
- **WGS84 (EPSG:4326) by default** for API output
- **Table prefix `sanson_`** for metadata tables (workspaces, layers, import history) — no dedicated schema for now, revisit later if needed
- **Vite proxy** — admin UI dev server on port 5173 proxies `/api`, `/collections`, `/conformance`, `/health` to API on port 3000

## Roadmap / next steps

### 1. Shapefile support

- Import via `ogr2ogr` (GDAL CLI) with SRID detection and reprojection
- Uses pg-boss for async processing (large files)
- PostgreSQL `COPY` for bulk insert performance

### 2. Quick wins

- Docker build for production deployment
- `packages/core/` extraction (shared types, CQL2 parser)

### 3. OGC CITE validation

- Run OGC official test suite (TEAM Engine) against Sanson to validate conformance
- Docker: `ogccite/teamengine-production` — test suites for Features 1.0 and Tiles 1.0
- Online: https://cite.opengeospatial.org/teamengine/
- Fix any conformance gaps found by the test suite

## Out of scope — do not add

- Authentication / authorization
- Multi-environment management
- WMS, WFS, WCS, WPS protocols
- ORMs or query builders
- Redis or external message queues
- Raster tile generation

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
- **Job queue**: pg-boss (PostgreSQL-based, no Redis or external queue)
- **Geo ingestion**: `ogr2ogr` CLI + PostgreSQL `COPY` (proven pattern for large volumes)
- **Tests**: vitest + Testcontainers (real PostGIS — no DB mocking)
- **Linting**: ESLint + Prettier, enforced on commit via Husky + lint-staged

## Monorepo layout

```
packages/core/    Shared types, DB utilities, CQL2 parser
packages/api/     Fastify server (NODE_MODE=api)
packages/worker/  Ingestion workers (NODE_MODE=worker)
apps/admin/       React + MapLibre GL admin UI
docker/           Docker Compose for local PostgreSQL + PostGIS
```

## Running things

```bash
nvm use                                   # Node 24
pnpm install                              # install deps
docker compose -f docker/compose.yml up -d  # start DB
pnpm test                                 # run all tests
pnpm --filter @sanson/api test            # run api tests only
pnpm --filter @sanson/api dev             # dev server (needs DATABASE_URL)
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

## Key architectural decisions

- **Single binary, `NODE_MODE` env var** — `api`, `worker`, or `all` (default). Like Elasticsearch nodes.
- **pg-boss for job queue** — uses PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`. No Redis, no extra infra.
- **`ogr2ogr` for ingestion** — handles Shapefile parsing, SRID detection, reprojection. Output is CSV with EWKT, loaded via PostgreSQL `COPY` for performance on large volumes.
- **OGC API Features URLs** — collections are identified as `{workspaceId}:{layerName}` (e.g., `risques:icpe`)
- **WGS84 (EPSG:4326) by default** for API output, **Web Mercator (EPSG:3857)** for MVT tiles
- **Table prefix `sanson_`** for metadata tables (workspaces, layers, import history) — no dedicated schema for now, revisit later if needed

## Out of scope — do not add

- Authentication / authorization
- Multi-environment management
- WMS, WFS, WCS, WPS protocols
- ORMs or query builders
- Redis or external message queues
- Raster tile generation

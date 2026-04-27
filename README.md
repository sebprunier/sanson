<p align="center">
  <img src=".github/logo.png" alt="Sanson" width="200" />
</p>

<h1 align="center">Sanson</h1>

<p align="center">
  An open source geospatial server — OGC API Features compliant
</p>

<p align="center">
  <a href="https://github.com/sebprunier/sanson/actions/workflows/ci.yml"><img src="https://github.com/sebprunier/sanson/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/sebprunier/sanson" alt="License" /></a>
  <a href=".nvmrc"><img src="https://img.shields.io/badge/node-%3E%3D24-brightgreen" alt="Node.js" /></a>
</p>

---

Sanson exposes geographic data stored in PostgreSQL/PostGIS via clean, modern REST APIs — compliant with **OGC API — Features**.

> Named after **Nicolas Sanson** (1600–1667), father of French cartography and royal geographer to Louis XIII and Louis XIV.

---

## Features

- **OGC API — Features compliant** — compatible out of the box with QGIS, ArcGIS, FME, and any OGC-compliant client
- **CQL2 filtering** — filter features by attributes and geometry using the OGC CQL2 Text standard (`=`, `<>`, `<`, `>`, `AND`, `OR`, `NOT`, `LIKE`, `IN`, `IS NULL`, `S_INTERSECTS`, `S_WITHIN`, `S_CONTAINS`)
- **Bbox, datetime, and proximity filtering** — spatial bounding box, temporal filters (OGC Core), and `lat`+`lon`+`radius` geographic shortcuts
- **Async data import** — background import via pg-boss with progress tracking, batch inserts, and import history. Supports GeoJSON (`.geojson`, `.json`, `.geojson.gz`, `.gz`), CSV (`.csv` with auto-detection of separator and geo columns), and Shapefile (`.zip` via `ogr2ogr` with SRID auto-detection and reprojection)
- **Queryables** — discover filterable properties for each collection
- **OGC pagination** — `self`, `next`, `prev`, `first`, `last` links in body and HTTP `Link` header + `X-Total-Count`
- **Web admin UI** — dashboard, workspace and collection management, data import, interactive map and table views with CQL2 filter
- **Collection settings** — configure description, attribution, datetime column, exposed fields (column visibility + aliasing), and style directly from the admin UI
- **Collection style & legend** — single color, categorized (unique values), or graduated (numeric ranges) styling with auto-classification, color palettes, and live map legend
- **GeoJSON export** — download any collection as a GeoJSON file, respecting exposed fields configuration
- **API Explorer** — interactive API documentation powered by [Scalar](https://scalar.com), built into the admin UI
- **Workspaces** — organize collections by theme or project
- **Vector tiles (MVT)** — Mapbox Vector Tiles via `ST_AsMVT` at `/collections/{id}/tiles/{z}/{x}/{y}.pbf`
- **OpenAPI documentation** — auto-generated from route schemas

## What Sanson is not

- An API management tool (no auth, no quotas — use a dedicated gateway for that)
- An environment manager (no staging/prod concepts)
- A WMS/WFS/WCS server (OGC API Features covers the use case with a modern approach)

---

## Tech stack

| Component | Technology                                   |
| --------- | -------------------------------------------- |
| API       | Node.js 24 + TypeScript + Fastify 5          |
| Workers   | pg-boss (PostgreSQL-based job queue)         |
| Database  | PostgreSQL 16 + PostGIS 3.4                  |
| Admin UI  | React 19 + Vite + Tailwind CSS + MapLibre GL |

---

## Getting started

### Prerequisites

- [Node.js 24](https://nodejs.org) (via [nvm](https://github.com/nvm-sh/nvm): `nvm use`)
- [pnpm](https://pnpm.io): `npm install -g pnpm`
- [Docker](https://www.docker.com) (for the database and integration tests)
- [GDAL/ogr2ogr](https://gdal.org) (optional, required for Shapefile import — `gdal-bin` on Debian/Ubuntu, `gdal` on macOS via Homebrew)

### Setup

```bash
# Clone the repo and navigate to it
git clone https://github.com/sebprunier/sanson.git && cd sanson

# Use the right Node version
nvm use

# Install dependencies
pnpm install

# Create your .env from the example
cp .env.example .env

# Start the database
docker compose -f docker/compose.yml up -d

# Start the API in dev mode
pnpm dev

# Start the admin UI in dev mode (separate terminal)
pnpm --filter @sanson/admin dev
```

The API is available at `http://localhost:3000`, and the admin UI at `http://localhost:5173`.

### Key endpoints

```
GET /                                        OGC landing page
GET /conformance                             OGC conformance declaration
GET /collections                             List all feature collections
GET /collections/{id}/items                  Features with pagination, bbox, datetime, lat/lon/radius
GET /collections/{id}/items/{fid}            Single feature by ID
GET /collections/{id}/queryables             Queryable properties (JSON Schema)
GET /collections/{id}/tiles/{z}/{x}/{y}.pbf  Mapbox Vector Tile (MVT)
GET /collections/{id}/style                  Collection style configuration
GET /api                                     OpenAPI 3.0 specification
GET /health                                  Database connectivity check
POST /api/admin/import                       Import a data file (GeoJSON, CSV, Shapefile — async, returns 202)
POST /api/admin/import/preview               Preview a file before importing (metadata, sample data, map)
GET  /api/admin/jobs                         List import jobs (status, progress, history)
GET  /api/admin/jobs/:id                     Get a specific job status
GET  /api/admin/collections/:id/export            Export collection as GeoJSON or CSV (?format=)
GET  /api/admin/collections/:id/classify          Auto-classify a column for styling
```

---

## Deployment

A production-ready Docker image is published on every push to `main`
(`:edge`, `:sha-<short>`) and on every `v*` tag (`:0.1.0`, `:0.1`, `:latest`):

```
ghcr.io/sebprunier/sanson
```

The image embeds the API server, the worker, and the static admin UI. A
single environment variable, `NODE_MODE`, decides what the container
runs:

| `NODE_MODE` | What runs                                                    |
| ----------- | ------------------------------------------------------------ |
| `all`       | HTTP server + ingestion worker in the same process (default) |
| `api`       | HTTP server only — pair with one or more `worker` nodes      |
| `worker`    | Ingestion worker only — no HTTP listener                     |

### Quickstart with Docker Compose

A reference `docker/compose.prod.yml` shows the canonical multi-node
setup (one `api`, one `worker`, one `db`):

```bash
IMAGE=ghcr.io/sebprunier/sanson:edge \
  docker compose -f docker/compose.prod.yml up -d
```

The compose file mounts a shared `uploads` volume between the API and
the worker; both processes need the same file tree until the S3
backend ships ([#7](https://github.com/sebprunier/sanson/issues/7)).
For a single-node "all-in-one" deployment, an alternative service is
commented out in the same file.

### Image essentials

- Base: `node:24-bookworm-slim` + `gdal-bin` (required by `ogr2ogr` for
  Shapefile / GeoPackage imports)
- Runs as the unprivileged `node` user
- `EXPOSE 3000`
- `HEALTHCHECK` hits `/health` every 30s
- The static admin UI is served at `/admin/` when `ADMIN_UI_DIR` is set
  (defaulted in the image)

### Environment variables

| Variable       | Default         | Notes                                            |
| -------------- | --------------- | ------------------------------------------------ |
| `DATABASE_URL` | _(required)_    | PostgreSQL/PostGIS connection string             |
| `NODE_MODE`    | `all`           | `api`, `worker`, or `all`                        |
| `PORT`         | `3000`          | HTTP port (ignored in worker-only mode)          |
| `UPLOAD_DIR`   | `/app/uploads`  | Where uploaded files are staged before ingestion |
| `ADMIN_UI_DIR` | `/app/admin-ui` | Set to empty to disable serving the admin UI     |

---

## Development

### Monorepo structure

```
sanson/
├── packages/
│   ├── api/        Fastify server — OGC API + admin routes
│   └── worker/     pg-boss job queue + async ingestion workers
├── apps/
│   └── admin/      React admin UI (Tailwind CSS + MapLibre GL)
├── docker/
│   └── compose.yml PostgreSQL + PostGIS (port 5433)
├── scripts/
│   └── init.sql    Database initialization
├── data/           Test datasets
├── docs/           VitePress documentation (deployed to GitHub Pages)
└── SPECS.md        Full project specifications
```

### Commands

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @sanson/api test

# Watch mode
pnpm --filter @sanson/api test:watch

# Dev server (hot reload, reads .env automatically)
pnpm dev

# Admin UI dev server (proxies API calls to localhost:3000)
pnpm --filter @sanson/admin dev

# E2E tests (requires API + admin UI running)
pnpm --filter @sanson/admin e2e

# E2E tests with visible browser
pnpm --filter @sanson/admin e2e:headed

# Lint
pnpm lint

# Format
pnpm format
```

### Testing

- **Integration tests** — real HTTP via `fastify.inject` + real PostgreSQL/PostGIS via [Testcontainers](https://testcontainers.com)
- **E2E tests** — [Playwright](https://playwright.dev) with Chromium, testing the admin UI against a running API
- No mocking of the database — if it passes tests, it works against a real PostGIS instance

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)

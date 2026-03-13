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
- **GeoJSON import** — synchronous import with automatic table creation and spatial indexing
- **Queryables** — discover filterable properties for each collection
- **Web admin UI** — dashboard, workspace and layer management, data import, interactive map and table views
- **Workspaces** — organize layers by theme or project
- **OpenAPI documentation** — auto-generated from route schemas

### Planned

- **Vector tiles** — Mapbox Vector Tiles (MVT) via `ST_AsMVT`
- **Shapefile import** — via `ogr2ogr` with SRID detection and reprojection
- **Async ingestion** — background workers with pg-boss for large datasets

## What Sanson is not

- An API management tool (no auth, no quotas — use a dedicated gateway for that)
- An environment manager (no staging/prod concepts)
- A WMS/WFS/WCS server (OGC API Features covers the use case with a modern approach)

---

## Tech stack

| Component | Technology                                   |
| --------- | -------------------------------------------- |
| API       | Node.js 24 + TypeScript + Fastify 5          |
| Database  | PostgreSQL 16 + PostGIS 3.4                  |
| Admin UI  | React 19 + Vite + Tailwind CSS + MapLibre GL |

---

## Getting started

### Prerequisites

- [Node.js 24](https://nodejs.org) (via [nvm](https://github.com/nvm-sh/nvm): `nvm use`)
- [pnpm](https://pnpm.io): `npm install -g pnpm`
- [Docker](https://www.docker.com) (for the database and integration tests)

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
GET /collections/{id}/items                  Features with pagination and bbox filter
GET /collections/{id}/items/{fid}            Single feature by ID
GET /collections/{id}/queryables             Queryable properties (JSON Schema)
GET /api                                     OpenAPI 3.0 specification
GET /health                                  Database connectivity check
POST /api/admin/import                       Import a GeoJSON file
```

---

## Development

### Monorepo structure

```
sanson/
├── packages/
│   └── api/        Fastify server — OGC API + admin routes
├── apps/
│   └── admin/      React admin UI (Tailwind CSS + MapLibre GL)
├── docker/
│   └── compose.yml PostgreSQL + PostGIS (port 5433)
├── scripts/
│   └── init.sql    Database initialization
├── data/           Test datasets
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

# Lint
pnpm lint

# Format
pnpm format
```

### Testing

- **Integration tests** — real HTTP via `fastify.inject` + real PostgreSQL/PostGIS via [Testcontainers](https://testcontainers.com)
- No mocking of the database — if it passes tests, it works against a real PostGIS instance

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)

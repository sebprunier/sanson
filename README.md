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
- **Vector tiles** — Mapbox Vector Tiles (MVT) via `ST_AsMVT`
- **CQL2 filtering** — filter features by attributes and geometry using the OGC CQL2 standard
- **Data ingestion** — import GeoJSON and Shapefile data with automatic SRID detection and reprojection
- **Web admin UI** — explore layers, visualize data on a map, manage imports
- **Workspaces** — organize layers by theme or project

## What Sanson is not

- An API management tool (no auth, no quotas — use a dedicated gateway for that)
- An environment manager (no staging/prod concepts)
- A WMS/WFS/WCS server (OGC API Features covers the use case with a modern approach)

---

## Tech stack

| Component     | Technology                        |
| ------------- | --------------------------------- |
| API + Worker  | Node.js 24 + TypeScript + Fastify |
| Database      | PostgreSQL 16 + PostGIS 3.4       |
| Job queue     | PostgreSQL + pg-boss              |
| Geo ingestion | ogr2ogr (GDAL) + PostgreSQL COPY  |
| Admin UI      | React + MapLibre GL JS + Vite     |

---

## Getting started

### Prerequisites

- [Node.js 24](https://nodejs.org) (via [nvm](https://github.com/nvm-sh/nvm): `nvm use`)
- [pnpm](https://pnpm.io): `npm install -g pnpm`
- [Docker](https://www.docker.com) (for the database and integration tests)
- [GDAL](https://gdal.org) (`brew install gdal` on macOS)

### Setup

```bash
# Clone the repo and navigate to it
git clone <repo-url> && cd sanson

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
```

The API is available at `http://localhost:3000`.

### Key endpoints

```
GET /              OGC landing page
GET /conformance   OGC conformance declaration
GET /collections   List all feature collections
GET /api           OpenAPI 3.0 specification
GET /health        Database connectivity check
```

---

## Development

### Monorepo structure

```
sanson/
├── packages/
│   ├── core/       Shared types, DB utilities, CQL2 parser
│   ├── api/        Fastify server — OGC API + admin routes
│   └── worker/     pg-boss workers — data ingestion pipeline
├── apps/
│   └── admin/      React admin UI (MapLibre GL)
├── docker/
│   └── compose.yml PostgreSQL + PostGIS
└── SPECS.md        Full project specifications
```

### Node mode

Sanson ships as a single binary. The `NODE_MODE` environment variable controls what starts:

| Value    | Behavior                                     |
| -------- | -------------------------------------------- |
| `api`    | HTTP server only                             |
| `worker` | Ingestion workers only                       |
| `all`    | Both (default — recommended for development) |

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

# Lint
pnpm lint

# Format
pnpm format
```

### Testing

- **Unit tests** — pure logic (CQL2 parser, utilities), no external dependencies
- **Integration tests** — real HTTP via `fastify.inject` + real PostgreSQL/PostGIS via [Testcontainers](https://testcontainers.com)
- No mocking of the database — if it passes tests, it works against a real PostGIS instance

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)

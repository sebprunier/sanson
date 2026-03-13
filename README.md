# Sanson

An open source geospatial server that exposes geographic data stored in PostgreSQL/PostGIS via clean, modern REST APIs — compliant with **OGC API — Features**.

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

# Start the database
docker compose -f docker/compose.yml up -d

# Start the API in dev mode
DATABASE_URL=postgresql://sanson:sanson@localhost:5432/sanson pnpm --filter @sanson/api dev
```

The API is available at `http://localhost:3000`.

### Key endpoints

```
GET /              OGC landing page
GET /health        Database connectivity check
GET /conformance   OGC conformance declaration
GET /collections   List all workspaces and layers
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

# Dev server (hot reload)
DATABASE_URL=... pnpm --filter @sanson/api dev

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

Specs are in [`SPECS.md`](./SPECS.md). Read them before contributing.

---

## License

MIT

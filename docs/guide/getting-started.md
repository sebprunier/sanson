# Getting Started

## Prerequisites

- [Node.js 24](https://nodejs.org) (via [nvm](https://github.com/nvm-sh/nvm): `nvm use`)
- [pnpm](https://pnpm.io): `npm install -g pnpm`
- [Docker](https://www.docker.com) (for the database)

## Setup

```bash
# Clone the repo
git clone https://github.com/sebprunier/sanson.git
cd sanson

# Use the right Node version
nvm use

# Install dependencies
pnpm install

# Create your .env from the example
cp .env.example .env
```

## Start the database

Sanson uses PostgreSQL 16 with PostGIS 3.4. A Docker Compose file is provided:

```bash
docker compose -f docker/compose.yml up -d
```

This starts PostgreSQL on port **5433** and automatically runs `scripts/init.sql` to create the metadata tables.

## Start the API

```bash
pnpm dev
```

The API is available at [http://localhost:3000](http://localhost:3000). By default, `NODE_MODE=all` starts both the HTTP server and the background worker.

## Start the admin UI

In a separate terminal:

```bash
pnpm --filter @sanson/admin dev
```

The admin UI is available at [http://localhost:5173](http://localhost:5173). It proxies API calls to the backend automatically.

## Verify it works

```bash
# OGC landing page
curl http://localhost:3000/

# Health check (database connectivity)
curl http://localhost:3000/health

# List collections (empty at first)
curl http://localhost:3000/collections
```

## What's next?

- [Import your first dataset](/guide/data-import) — upload a GeoJSON file and explore it
- [Configuration](/guide/configuration) — customize NODE_MODE, database URL, and more
- [API Reference](/api/ogc-endpoints) — explore the full OGC API

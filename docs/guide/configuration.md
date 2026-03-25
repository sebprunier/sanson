# Configuration

Sanson is configured via environment variables. Copy `.env.example` to `.env` to get started.

## Environment variables

| Variable       | Description                  | Default                                            |
| -------------- | ---------------------------- | -------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://sanson:sanson@localhost:5433/sanson` |
| `PORT`         | HTTP server port             | `3000`                                             |
| `NODE_MODE`    | Startup mode (see below)     | `all`                                              |
| `UPLOAD_DIR`   | Directory for uploaded files | `./uploads`                                        |

## NODE_MODE

Sanson is distributed as a single process. The `NODE_MODE` environment variable controls what starts:

| Value    | Behavior                                                        |
| -------- | --------------------------------------------------------------- |
| `all`    | Starts both the HTTP server and the background worker (default) |
| `api`    | Starts the HTTP server only (Fastify)                           |
| `worker` | Starts the background worker only (pg-boss)                     |

### When to use each mode

- **Development and small deployments**: use `all` (default) — everything runs in a single process.
- **Production**: separate `api` and `worker` nodes for independent scaling. Run multiple API nodes behind a load balancer, and scale workers based on import workload.

### Shared filesystem

When `api` and `worker` run as separate processes, they need access to the **same `UPLOAD_DIR`**. The API saves uploaded files to disk, and the worker reads them for processing. Use a shared volume, NFS mount, or object storage (planned) to ensure both can access the files.

## Database

Sanson requires PostgreSQL 16+ with PostGIS 3.4+. The provided Docker Compose file handles this:

```bash
docker compose -f docker/compose.yml up -d
```

The database is initialized automatically via `scripts/init.sql`, which creates:

- `sanson_workspaces` — workspace metadata
- `sanson_collections` — collection metadata (OGC collections)
- `sanson_import_history` — import job tracking with progress and logs

A `default` workspace is created at initialization.

### Connection string

The default connection string is:

```
postgresql://sanson:sanson@localhost:5433/sanson
```

Set `DATABASE_URL` to point to your own PostgreSQL instance in production.

### Resetting the database

To reset everything (metadata + imported data):

```bash
docker compose -f docker/compose.yml down -v
docker compose -f docker/compose.yml up -d
```

The `-v` flag removes the PostgreSQL data volume, so `init.sql` runs again on startup.

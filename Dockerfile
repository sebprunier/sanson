# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24
ARG PNPM_VERSION=10

# ── Stage 1: deps ──────────────────────────────────────────────────────────
# Install all dependencies (dev + prod) so subsequent stages can build.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# Copy only manifest files first to maximise Docker layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/worker/package.json packages/worker/package.json
COPY packages/api/package.json packages/api/package.json
COPY apps/admin/package.json apps/admin/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 2: build ─────────────────────────────────────────────────────────
# Build all workspaces. Order matters: core → worker → api (which imports
# both) → admin (independent).
FROM deps AS build
COPY . .
RUN pnpm --filter @sanson/core build \
 && pnpm --filter @sanson/worker build \
 && pnpm --filter @sanson/api build \
 && pnpm --filter @sanson/admin build

# ── Stage 3: prune ─────────────────────────────────────────────────────────
# Use `pnpm deploy` to extract the API workspace as a self-contained tree
# with production-only deps and workspace deps inlined (with their dist/).
FROM build AS prune
RUN pnpm --filter @sanson/api deploy --legacy --prod /deploy

# ── Stage 4: runtime ───────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# gdal-bin: required by ogr2ogr for Shapefile / GeoPackage import
# curl:     used by the HEALTHCHECK
RUN apt-get update \
 && apt-get install -y --no-install-recommends gdal-bin curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# API source (compiled) + production node_modules
COPY --from=prune /deploy /app
# Built admin UI assets, served by the API when ADMIN_UI_DIR is set
COPY --from=build /app/apps/admin/dist /app/admin-ui
# SQL bootstrap script (handy for compose setups that mount it into Postgres)
COPY scripts/init.sql /app/scripts/init.sql

# Drop privileges. The official node image ships a `node` user (uid 1000).
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node

ENV NODE_ENV=production \
    NODE_MODE=all \
    PORT=3000 \
    UPLOAD_DIR=/app/uploads \
    ADMIN_UI_DIR=/app/admin-ui

EXPOSE 3000

# The healthcheck only makes sense when the HTTP server runs. Worker-only
# nodes can override it with `--no-healthcheck` when they start the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

CMD ["node", "dist/server.js"]

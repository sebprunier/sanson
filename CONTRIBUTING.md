# Contributing to Sanson

Thanks for your interest in contributing to Sanson!

## Getting started

1. Fork and clone the repository
2. Install prerequisites: Node.js 24 (`nvm use`), pnpm, Docker
3. Run `pnpm install`
4. Start the database: `docker compose -f docker/compose.yml up -d`
5. Run the tests: `pnpm test`

## Development workflow

1. Read the [specifications](./SPECS.md) to understand the project goals and architecture
2. Create a branch from `main`
3. Write your code — all code, comments, and commit messages must be in **English**
4. Write tests — integration tests with real PostGIS via Testcontainers, no database mocks
5. Run `pnpm test` to make sure everything passes
6. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`)
7. Open a pull request

## Code conventions

- **TypeScript strict mode** — no `any`
- **Raw SQL** via `pg` — no ORM, no query builder
- **Fastify route pattern** — routes in `src/routes/`, registered in `app.ts`, with JSON schemas for OpenAPI
- **`buildApp(db: Pool)`** — app factory for testability

## Testing conventions

- Integration tests use [Testcontainers](https://testcontainers.com) with `postgis/postgis:16-3.4`
- One container per `describe` block (`beforeAll` / `afterAll`)
- Routes that don't need the database use a dummy `{ end: async () => {} } as unknown as Pool`
- `hookTimeout: 120_000` in vitest config for slow container pulls

## What's out of scope

See the [Out of scope](./SPECS.md#3-out-of-scope) section in the specs. Don't add authentication, WMS/WFS support, ORMs, or Redis.

## Reporting issues

Open an issue on GitHub. Include steps to reproduce, expected behavior, and actual behavior.

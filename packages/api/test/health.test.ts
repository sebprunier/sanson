import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { buildApp } from '../src/app.js'

describe('GET /health', () => {
  let container: StartedPostgreSqlContainer
  let db: Pool

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    db = new Pool({ connectionString: container.getConnectionUri() })
  })

  afterAll(async () => {
    await db.end()
    await container.stop()
  })

  it('returns 200 when db is reachable', async () => {
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/health' })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', db: 'ok' })
  })

  it('returns 503 when db is unreachable', async () => {
    const brokenDb = new Pool({ connectionString: 'postgresql://bad:bad@localhost:9999/bad' })
    const app = buildApp(brokenDb)
    const response = await app.inject({ method: 'GET', url: '/health' })
    await app.close()
    await brokenDb.end()

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'error', db: 'error' })
  })
})

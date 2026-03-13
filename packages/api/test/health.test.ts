import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { buildApp } from '../src/app'

describe('GET /health', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('returns 200 when db is reachable', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/health' })
    await app.close() // closes the pool via onClose hook

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', db: 'ok' })
  })

  it('returns 503 when db is unreachable', async () => {
    const db = new Pool({ connectionString: 'postgresql://bad:bad@localhost:9999/bad' })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/health' })
    await app.close() // closes the pool via onClose hook

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'error', db: 'error' })
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildApp } from '../../src/app'

const initSql = readFileSync(join(__dirname, '../../../../scripts/init.sql'), 'utf-8')

describe('Admin config API', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)
    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('GET /api/admin/config — returns all config entries', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/api/admin/config' })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.length).toBe(9)

    const keys = body.map((e: { key: string }) => e.key)
    expect(keys).toContain('upload.max_file_size_mb')
    expect(keys).toContain('import.batch_size')
    expect(keys).toContain('import.csv_inference_rows')
    expect(keys).toContain('import.default_srid')
    expect(keys).toContain('jobs.retry_limit')
    expect(keys).toContain('jobs.retry_delay_seconds')
    expect(keys).toContain('jobs.expire_hours')
    expect(keys).toContain('jobs.archive_days')
    expect(keys).toContain('tiles.cache_ttl_seconds')
  })

  it('GET /api/admin/config — entries have expected fields', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/api/admin/config' })
    await app.close()

    const entry = response.json().find((e: { key: string }) => e.key === 'import.batch_size')
    expect(entry).toBeDefined()
    expect(entry.value).toBe('500')
    expect(entry.category).toBe('import')
    expect(entry.label).toBe('Batch size')
    expect(entry.description).toBeTruthy()
    expect(entry.restart).toBe(false)
  })

  it('PUT /api/admin/config — updates config values', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)

    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/config',
      payload: [
        { key: 'import.batch_size', value: '1000' },
        { key: 'tiles.cache_ttl_seconds', value: '7200' },
      ],
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    const batch = body.find((e: { key: string }) => e.key === 'import.batch_size')
    const cache = body.find((e: { key: string }) => e.key === 'tiles.cache_ttl_seconds')
    expect(batch.value).toBe('1000')
    expect(cache.value).toBe('7200')
  })

  it('PUT /api/admin/config — updated values persist', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/api/admin/config' })
    await app.close()

    const batch = response.json().find((e: { key: string }) => e.key === 'import.batch_size')
    expect(batch.value).toBe('1000')
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import FormData from 'form-data'
import PgBoss from 'pg-boss'
import { buildApp } from '../../src/app'
import { startWorker, ensureQueues } from '@sanson/worker'

const initSql = readFileSync(join(__dirname, '../../../../scripts/init.sql'), 'utf-8')
const geojsonPath = join(
  __dirname,
  '../../../../data/centrales-de-production-nucleaire-edf.geojson',
)
const geojsonBuffer = readFileSync(geojsonPath)

describe('POST /api/admin/import (async)', () => {
  let container: StartedPostgreSqlContainer
  let workspaceId: string
  let boss: PgBoss
  let workerDb: Pool

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    workerDb = new Pool({ connectionString: container.getConnectionUri() })
    await workerDb.query(initSql)

    // Get the default workspace ID
    const { rows } = await workerDb.query("SELECT id FROM sanson_workspaces WHERE name = 'default'")
    workspaceId = rows[0].id

    // Start pg-boss + worker
    boss = new PgBoss({
      connectionString: container.getConnectionUri(),
      schema: 'pgboss',
    })
    await boss.start()
    await ensureQueues(boss)
    await startWorker(boss, workerDb)
  })

  afterAll(async () => {
    await boss.stop({ graceful: true })
    await workerDb.end()
    await container.stop()
  })

  it('queues an import job and returns 202', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db, { boss })

    const form = new FormData()
    form.append('workspace_id', workspaceId)
    form.append('layer_name', 'centrales')
    form.append('file', geojsonBuffer, {
      filename: 'centrales.geojson',
      contentType: 'application/json',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/import',
      payload: form,
      headers: form.getHeaders(),
    })
    await app.close()

    expect(response.statusCode).toBe(202)
    const body = response.json()
    expect(body.import_id).toBeDefined()
    expect(body.status).toBe('pending')
    expect(body.message).toBe('Import job queued')
  })

  it('worker processes the job and features become accessible', async () => {
    // Wait for the worker to process the job
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const maxWait = 15_000
    const start = Date.now()
    let status = 'pending'

    while (status !== 'completed' && status !== 'failed' && Date.now() - start < maxWait) {
      const { rows } = await db.query(
        `SELECT status FROM sanson_import_history WHERE source_file = 'centrales.geojson' ORDER BY created_at DESC LIMIT 1`,
      )
      if (rows.length > 0) status = rows[0].status
      if (status !== 'completed' && status !== 'failed') {
        await new Promise((r) => setTimeout(r, 500))
      }
    }

    expect(status).toBe('completed')

    // Verify features are accessible via OGC API
    const app = buildApp(db)
    const itemsResponse = await app.inject({
      method: 'GET',
      url: '/collections/default:centrales/items?limit=5',
    })
    expect(itemsResponse.statusCode).toBe(200)
    const items = itemsResponse.json()
    expect(items.numberMatched).toBe(56)
    expect(items.features).toHaveLength(5)
    await app.close()
  })

  it('records import in history with progress tracking', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })

    const { rows } = await db.query(
      `SELECT source_file, feature_count, total_features, imported_features,
              progress, status, duration_ms, started_at, completed_at, logs
       FROM sanson_import_history
       WHERE source_file = 'centrales.geojson'
       ORDER BY created_at DESC LIMIT 1`,
    )
    await db.end()

    expect(rows).toHaveLength(1)
    expect(rows[0].feature_count).toBe('56')
    expect(rows[0].total_features).toBe('56')
    expect(rows[0].imported_features).toBe('56')
    expect(rows[0].progress).toBe(100)
    expect(rows[0].status).toBe('completed')
    expect(rows[0].duration_ms).toBeGreaterThan(0)
    expect(rows[0].started_at).toBeTruthy()
    expect(rows[0].completed_at).toBeTruthy()
    expect(rows[0].logs.length).toBeGreaterThan(0)
  })

  it('job status is accessible via admin API', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)

    // Get import ID
    const { rows } = await db.query(
      `SELECT id FROM sanson_import_history WHERE source_file = 'centrales.geojson' ORDER BY created_at DESC LIMIT 1`,
    )
    const importId = rows[0].id

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/jobs/${importId}`,
    })
    expect(response.statusCode).toBe(200)
    const job = response.json()
    expect(job.status).toBe('completed')
    expect(job.progress).toBe(100)
    expect(job.logs.length).toBeGreaterThan(0)
    expect(job.source_file).toBe('centrales.geojson')

    // List jobs
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/jobs',
    })
    expect(listResponse.statusCode).toBe(200)
    const jobs = listResponse.json()
    expect(jobs.length).toBeGreaterThan(0)

    // Filter by status
    const filteredResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/jobs?status=completed',
    })
    expect(filteredResponse.statusCode).toBe(200)
    expect(filteredResponse.json().length).toBeGreaterThan(0)

    await app.close()
  })

  it('returns 400 for missing fields', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db, { boss })

    const form = new FormData()
    form.append('workspace_id', workspaceId)
    // Missing layer_name and file

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/import',
      payload: form,
      headers: form.getHeaders(),
    })
    await app.close()

    expect(response.statusCode).toBe(400)
  })

  it('returns 400 for invalid workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db, { boss })

    const form = new FormData()
    form.append('workspace_id', '00000000-0000-0000-0000-999999999999')
    form.append('layer_name', 'test')
    form.append('file', geojsonBuffer, {
      filename: 'test.geojson',
      contentType: 'application/json',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/import',
      payload: form,
      headers: form.getHeaders(),
    })
    await app.close()

    expect(response.statusCode).toBe(400)
  })
})

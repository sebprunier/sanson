import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildApp } from '../../src/app'

const initSql = readFileSync(join(__dirname, '../../../../scripts/init.sql'), 'utf-8')

describe('Admin workspaces API', () => {
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

  it('GET /api/admin/workspaces — lists workspaces (default exists)', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/api/admin/workspaces' })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.length).toBeGreaterThanOrEqual(1)
    expect(body.find((w: { name: string }) => w.name === 'default')).toBeDefined()
  })

  it('POST /api/admin/workspaces — creates a workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/workspaces',
      payload: { name: 'transport', description: 'Transport data' },
    })
    await app.close()

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.name).toBe('transport')
    expect(body.description).toBe('Transport data')
    expect(body.id).toBeDefined()
  })

  it('POST /api/admin/workspaces — returns 409 on duplicate name', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/workspaces',
      payload: { name: 'default' },
    })
    await app.close()

    expect(response.statusCode).toBe(409)
  })

  it('GET /api/admin/workspaces/:id — returns workspace details', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    // Get the default workspace ID
    const { rows } = await db.query("SELECT id FROM sanson_workspaces WHERE name = 'default'")
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/workspaces/${rows[0].id}`,
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json().name).toBe('default')
  })

  it('GET /api/admin/workspaces/:id — returns 404 for unknown', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/workspaces/00000000-0000-0000-0000-000000000099',
    })
    await app.close()

    expect(response.statusCode).toBe(404)
  })

  it('PUT /api/admin/workspaces/:id — updates a workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_workspaces WHERE name = 'transport'")
    const app = buildApp(db)
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/workspaces/${rows[0].id}`,
      payload: { description: 'Updated description' },
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json().description).toBe('Updated description')
    expect(response.json().name).toBe('transport')
  })

  it('DELETE /api/admin/workspaces/:id — deletes a workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_workspaces WHERE name = 'transport'")
    const wsId = rows[0].id
    const app = buildApp(db)

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/workspaces/${wsId}`,
    })
    expect(deleteRes.statusCode).toBe(204)

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/admin/workspaces/${wsId}`,
    })
    expect(getRes.statusCode).toBe(404)

    await app.close()
  })

  it('DELETE /api/admin/workspaces/:id — returns 404 for unknown', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/workspaces/00000000-0000-0000-0000-000000000099',
    })
    await app.close()

    expect(response.statusCode).toBe(404)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildApp } from '../../src/app'

const initSql = readFileSync(join(__dirname, '../../../../scripts/init.sql'), 'utf-8')

describe('Admin layers API', () => {
  let container: StartedPostgreSqlContainer
  let workspaceId: string

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)
    await db.query(
      `INSERT INTO sanson_workspaces (id, name) VALUES ('00000000-0000-0000-0000-000000000040', 'energie')`,
    )
    workspaceId = '00000000-0000-0000-0000-000000000040'
    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('GET /api/admin/layers — returns empty list initially', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/api/admin/layers' })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('POST /api/admin/layers — creates a layer', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/layers',
      payload: {
        workspace_id: workspaceId,
        name: 'centrales',
        description: 'Nuclear plants',
        table_name: 'energie_centrales',
        srid: 4326,
      },
    })
    await app.close()

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.name).toBe('centrales')
    expect(body.workspace_name).toBe('energie')
    expect(body.table_name).toBe('energie_centrales')
    expect(body.srid).toBe(4326)
    expect(body.geometry_column).toBe('geom')
    expect(body.id_column).toBe('id')
  })

  it('POST /api/admin/layers — returns 409 on duplicate', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/layers',
      payload: {
        workspace_id: workspaceId,
        name: 'centrales',
        table_name: 'energie_centrales',
      },
    })
    await app.close()

    expect(response.statusCode).toBe(409)
  })

  it('POST /api/admin/layers — returns 400 for invalid workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/layers',
      payload: {
        workspace_id: '00000000-0000-0000-0000-999999999999',
        name: 'test',
        table_name: 'test_table',
      },
    })
    await app.close()

    expect(response.statusCode).toBe(400)
  })

  it('GET /api/admin/layers — lists layers', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/api/admin/layers' })
    await app.close()

    const body = response.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('centrales')
  })

  it('GET /api/admin/layers?workspace_id= — filters by workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/layers?workspace_id=${workspaceId}`,
    })
    expect(response.json()).toHaveLength(1)

    const responseOther = await app.inject({
      method: 'GET',
      url: '/api/admin/layers?workspace_id=00000000-0000-0000-0000-999999999999',
    })
    expect(responseOther.json()).toHaveLength(0)

    await app.close()
  })

  it('GET /api/admin/layers/:id — returns layer details', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_layers WHERE name = 'centrales'")
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/layers/${rows[0].id}`,
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json().name).toBe('centrales')
    expect(response.json().workspace_name).toBe('energie')
  })

  it('PUT /api/admin/layers/:id — updates a layer', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_layers WHERE name = 'centrales'")
    const app = buildApp(db)
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/layers/${rows[0].id}`,
      payload: { description: 'Updated description', srid: 2154 },
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json().description).toBe('Updated description')
    expect(response.json().srid).toBe(2154)
    expect(response.json().name).toBe('centrales')
  })

  it('DELETE /api/admin/layers/:id — deletes a layer', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_layers WHERE name = 'centrales'")
    const layerId = rows[0].id
    const app = buildApp(db)

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/layers/${layerId}`,
    })
    expect(deleteRes.statusCode).toBe(204)

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/admin/layers/${layerId}`,
    })
    expect(getRes.statusCode).toBe(404)

    await app.close()
  })
})

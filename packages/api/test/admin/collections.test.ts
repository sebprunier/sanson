import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildApp } from '../../src/app'

const initSql = readFileSync(join(__dirname, '../../../../scripts/init.sql'), 'utf-8')

describe('Admin collections API', () => {
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

  it('GET /api/admin/collections — returns empty list initially', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/api/admin/collections' })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('POST /api/admin/collections — creates a collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/collections',
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

  it('POST /api/admin/collections — returns 409 on duplicate', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/collections',
      payload: {
        workspace_id: workspaceId,
        name: 'centrales',
        table_name: 'energie_centrales',
      },
    })
    await app.close()

    expect(response.statusCode).toBe(409)
  })

  it('POST /api/admin/collections — returns 400 for invalid workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/collections',
      payload: {
        workspace_id: '00000000-0000-0000-0000-999999999999',
        name: 'test',
        table_name: 'test_table',
      },
    })
    await app.close()

    expect(response.statusCode).toBe(400)
  })

  it('GET /api/admin/collections — lists collections', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/api/admin/collections' })
    await app.close()

    const body = response.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('centrales')
  })

  it('GET /api/admin/collections?workspace_id= — filters by workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/collections?workspace_id=${workspaceId}`,
    })
    expect(response.json()).toHaveLength(1)

    const responseOther = await app.inject({
      method: 'GET',
      url: '/api/admin/collections?workspace_id=00000000-0000-0000-0000-999999999999',
    })
    expect(responseOther.json()).toHaveLength(0)

    await app.close()
  })

  it('GET /api/admin/collections/:id — returns collection details', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_collections WHERE name = 'centrales'")
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/collections/${rows[0].id}`,
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json().name).toBe('centrales')
    expect(response.json().workspace_name).toBe('energie')
  })

  it('PUT /api/admin/collections/:id — updates a collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_collections WHERE name = 'centrales'")
    const app = buildApp(db)
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/collections/${rows[0].id}`,
      payload: { description: 'Updated description', srid: 2154 },
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json().description).toBe('Updated description')
    expect(response.json().srid).toBe(2154)
    expect(response.json().name).toBe('centrales')
  })

  it('PUT /api/admin/collections/:id — saves and returns style', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_collections WHERE name = 'centrales'")
    const app = buildApp(db)

    const style = {
      type: 'single',
      fill_color: '#ff0000',
      fill_opacity: 0.5,
    }

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/collections/${rows[0].id}`,
      payload: { style },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().style).toEqual(style)

    // Verify it persists on GET
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/admin/collections/${rows[0].id}`,
    })
    expect(getRes.json().style).toEqual(style)

    await app.close()
  })

  it('PUT /api/admin/collections/:id — clears style with null', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_collections WHERE name = 'centrales'")
    const app = buildApp(db)

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/collections/${rows[0].id}`,
      payload: { style: null },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().style).toBeNull()

    await app.close()
  })

  describe('classify endpoint', () => {
    let collectionId: string

    beforeAll(async () => {
      const db = new Pool({ connectionString: container.getConnectionUri() })
      // Create a data table with some test data
      await db.query(`
        CREATE TABLE IF NOT EXISTS energie_cities (
          id SERIAL PRIMARY KEY,
          geom GEOMETRY(Point, 4326),
          name TEXT,
          population INTEGER,
          category TEXT
        )
      `)
      await db.query(`
        INSERT INTO energie_cities (geom, name, population, category) VALUES
          (ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326), 'Paris', 2161000, 'capital'),
          (ST_SetSRID(ST_MakePoint(4.83, 45.76), 4326), 'Lyon', 516092, 'major'),
          (ST_SetSRID(ST_MakePoint(5.37, 43.30), 4326), 'Marseille', 870018, 'major'),
          (ST_SetSRID(ST_MakePoint(1.44, 43.60), 4326), 'Toulouse', 493465, 'major'),
          (ST_SetSRID(ST_MakePoint(-1.55, 47.22), 4326), 'Nantes', 314138, 'medium')
      `)
      // Register as a collection
      const { rows } = await db.query(
        `INSERT INTO sanson_collections (workspace_id, name, table_name, geometry_column, id_column, srid)
         VALUES ($1, 'cities', 'energie_cities', 'geom', 'id', 4326) RETURNING id`,
        [workspaceId],
      )
      collectionId = rows[0].id
      await db.end()
    })

    it('GET /api/admin/collections/:id/classify — categorized', async () => {
      const db = new Pool({ connectionString: container.getConnectionUri() })
      const app = buildApp(db)
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/collections/${collectionId}/classify?field=category&type=categorized`,
      })
      await app.close()

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.type).toBe('categorized')
      expect(body.field).toBe('category')
      expect(body.categories).toHaveLength(3) // capital, major, medium
      expect(body.categories.map((c: { value: string }) => c.value).sort()).toEqual([
        'capital',
        'major',
        'medium',
      ])
    })

    it('GET /api/admin/collections/:id/classify — graduated (quantile)', async () => {
      const db = new Pool({ connectionString: container.getConnectionUri() })
      const app = buildApp(db)
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/collections/${collectionId}/classify?field=population&type=graduated&classes=3`,
      })
      await app.close()

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.type).toBe('graduated')
      expect(body.field).toBe('population')
      expect(body.method).toBe('quantile')
      expect(body.classes).toHaveLength(3)
      expect(body.classes[0].min).toBeDefined()
      expect(body.classes[2].max).toBeDefined()
    })

    it('GET /api/admin/collections/:id/classify — rejects non-numeric for graduated', async () => {
      const db = new Pool({ connectionString: container.getConnectionUri() })
      const app = buildApp(db)
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/collections/${collectionId}/classify?field=name&type=graduated`,
      })
      await app.close()

      expect(response.statusCode).toBe(400)
      expect(response.json().message).toContain('not numeric')
    })

    it('GET /api/admin/collections/:id/classify — rejects unknown field', async () => {
      const db = new Pool({ connectionString: container.getConnectionUri() })
      const app = buildApp(db)
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/collections/${collectionId}/classify?field=nonexistent&type=categorized`,
      })
      await app.close()

      expect(response.statusCode).toBe(400)
      expect(response.json().message).toContain('not found')
    })
  })

  it('DELETE /api/admin/collections/:id — deletes a collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const { rows } = await db.query("SELECT id FROM sanson_collections WHERE name = 'centrales'")
    const collectionId = rows[0].id
    const app = buildApp(db)

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/collections/${collectionId}`,
    })
    expect(deleteRes.statusCode).toBe(204)

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/admin/collections/${collectionId}`,
    })
    expect(getRes.statusCode).toBe(404)

    await app.close()
  })
})

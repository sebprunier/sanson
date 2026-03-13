import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildApp } from '../src/app'

const initSql = readFileSync(join(__dirname, '../../../scripts/init.sql'), 'utf-8')

describe('init.sql', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('creates a default workspace', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    const { rows } = await db.query(
      "SELECT name, description FROM sanson_workspaces WHERE name = 'default'",
    )
    await db.end()

    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('default')
    expect(rows[0].description).toBe('Default workspace')
  })
})

describe('GET /collections', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('returns an empty collection list on a fresh database', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections' })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.collections).toEqual([])
    expect(body.links).toHaveLength(1)
    expect(body.links[0].rel).toBe('self')
  })

  it('returns collections when layers exist', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    // Insert a workspace and a layer
    await db.query(
      `INSERT INTO sanson_workspaces (id, name, description)
       VALUES ('00000000-0000-0000-0000-000000000001', 'risques', 'Risk data')
       ON CONFLICT DO NOTHING`,
    )
    await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, description, table_name, bbox)
       VALUES ('00000000-0000-0000-0000-000000000001', 'icpe', 'Classified facilities', 'risques_icpe', '[-5.1, 41.3, 9.6, 51.1]')
       ON CONFLICT DO NOTHING`,
    )

    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections' })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.collections).toHaveLength(1)

    const col = body.collections[0]
    expect(col.id).toBe('risques:icpe')
    expect(col.title).toBe('icpe')
    expect(col.description).toBe('Classified facilities')
    expect(col.itemType).toBe('feature')
    expect(col.crs).toContain('http://www.opengis.net/def/crs/OGC/1.3/CRS84')
    expect(col.extent.spatial.bbox).toEqual([[-5.1, 41.3, 9.6, 51.1]])
  })

  it('includes OGC links for each collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    await db.query(
      `INSERT INTO sanson_workspaces (id, name)
       VALUES ('00000000-0000-0000-0000-000000000002', 'transport')
       ON CONFLICT DO NOTHING`,
    )
    await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, table_name)
       VALUES ('00000000-0000-0000-0000-000000000002', 'routes', 'transport_routes')
       ON CONFLICT DO NOTHING`,
    )

    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections' })
    await app.close()

    const body = response.json()
    const col = body.collections.find((c: { id: string }) => c.id === 'transport:routes')
    expect(col).toBeDefined()

    const rels = col.links.map((l: { rel: string }) => l.rel)
    expect(rels).toContain('self')
    expect(rels).toContain('items')
    expect(rels).toContain('queryables')
  })
})

describe('GET /collections/:collectionId', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)
    await db.query(
      `INSERT INTO sanson_workspaces (id, name, description)
       VALUES ('00000000-0000-0000-0000-000000000010', 'energie', 'Energy data')`,
    )
    await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, description, table_name, bbox)
       VALUES ('00000000-0000-0000-0000-000000000010', 'centrales', 'Nuclear power plants', 'energie_centrales', '[-4.5, 42.0, 8.2, 51.1]')`,
    )
    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('returns 200 with collection metadata', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections/energie:centrales' })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.id).toBe('energie:centrales')
    expect(body.title).toBe('centrales')
    expect(body.description).toBe('Nuclear power plants')
    expect(body.itemType).toBe('feature')
    expect(body.crs).toContain('http://www.opengis.net/def/crs/OGC/1.3/CRS84')
    expect(body.extent.spatial.bbox).toEqual([[-4.5, 42.0, 8.2, 51.1]])
  })

  it('includes OGC links', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections/energie:centrales' })
    await app.close()

    const rels = response.json().links.map((l: { rel: string }) => l.rel)
    expect(rels).toContain('self')
    expect(rels).toContain('items')
    expect(rels).toContain('queryables')
  })

  it('returns 404 for unknown collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections/foo:bar' })
    await app.close()

    expect(response.statusCode).toBe(404)
  })

  it('returns 404 when collectionId has no separator', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections/invalid' })
    await app.close()

    expect(response.statusCode).toBe(404)
  })
})

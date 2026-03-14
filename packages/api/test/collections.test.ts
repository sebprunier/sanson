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

describe('GET /collections/:collectionId/items', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    // Create a workspace and layer
    await db.query(
      `INSERT INTO sanson_workspaces (id, name)
       VALUES ('00000000-0000-0000-0000-000000000020', 'test')`,
    )

    // Create a data table with 3 points
    await db.query(`
      CREATE TABLE test_sites (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        geom GEOMETRY(Point, 4326)
      )
    `)
    await db.query(`CREATE INDEX idx_test_sites_geom ON test_sites USING GIST (geom)`)
    await db.query(`
      INSERT INTO test_sites (name, geom) VALUES
        ('Paris',     ST_SetSRID(ST_MakePoint(2.35, 48.86), 4326)),
        ('Lyon',      ST_SetSRID(ST_MakePoint(4.83, 45.76), 4326)),
        ('Marseille', ST_SetSRID(ST_MakePoint(5.37, 43.30), 4326))
    `)

    // Register the layer
    await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, table_name, geometry_column, id_column, srid)
       VALUES ('00000000-0000-0000-0000-000000000020', 'sites', 'test_sites', 'geom', 'id', 4326)`,
    )

    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('returns a FeatureCollection with all features', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections/test:sites/items' })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.type).toBe('FeatureCollection')
    expect(body.features).toHaveLength(3)
    expect(body.numberMatched).toBe(3)
    expect(body.numberReturned).toBe(3)
    expect(body.timeStamp).toBeDefined()
  })

  it('returns valid GeoJSON features', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections/test:sites/items' })
    await app.close()

    const body = response.json()
    const paris = body.features.find(
      (f: { properties: { name: string } }) => f.properties.name === 'Paris',
    )
    expect(paris).toBeDefined()
    expect(paris.type).toBe('Feature')
    expect(paris.geometry.type).toBe('Point')
    expect(paris.geometry.coordinates[0]).toBeCloseTo(2.35, 1)
    expect(paris.geometry.coordinates[1]).toBeCloseTo(48.86, 1)
  })

  it('paginates with limit and offset', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?limit=2',
    })
    await app.close()

    const body = response.json()
    expect(body.features).toHaveLength(2)
    expect(body.numberMatched).toBe(3)
    expect(body.numberReturned).toBe(2)

    const rels = body.links.map((l: { rel: string }) => l.rel)
    expect(rels).toContain('next')
    expect(rels).not.toContain('prev')
  })

  it('returns last page without next link', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?limit=2&offset=2',
    })
    await app.close()

    const body = response.json()
    expect(body.features).toHaveLength(1)
    expect(body.numberMatched).toBe(3)

    const rels = body.links.map((l: { rel: string }) => l.rel)
    expect(rels).not.toContain('next')
    expect(rels).toContain('prev')
  })

  it('filters by bbox', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    // bbox covering only Paris area
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?bbox=1,48,3,49',
    })
    await app.close()

    const body = response.json()
    expect(body.features).toHaveLength(1)
    expect(body.features[0].properties.name).toBe('Paris')
    expect(body.numberMatched).toBe(1)
  })

  it('sets X-Total-Count and Link headers', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?limit=2',
    })
    await app.close()

    expect(response.headers['x-total-count']).toBe('3')
    expect(response.headers['link']).toContain('rel="self"')
    expect(response.headers['link']).toContain('rel="next"')
  })

  it('includes first and last pagination links', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?limit=2',
    })
    await app.close()

    const body = response.json()
    const rels = body.links.map((l: { rel: string }) => l.rel)
    expect(rels).toContain('first')
    expect(rels).toContain('last')

    const firstLink = body.links.find((l: { rel: string }) => l.rel === 'first')
    expect(firstLink.href).toContain('offset=0')
    const lastLink = body.links.find((l: { rel: string }) => l.rel === 'last')
    expect(lastLink.href).toContain('offset=2')
  })

  it('preserves query params in pagination links', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?limit=2&bbox=1,43,6,49',
    })
    await app.close()

    const body = response.json()
    for (const link of body.links) {
      expect(link.href).toContain('bbox=')
    }
  })

  it('filters by lat/lon (point intersection)', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    // Point very close to Paris
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?lat=48.86&lon=2.35&radius=1000',
    })
    await app.close()

    const body = response.json()
    expect(body.numberMatched).toBe(1)
    expect(body.features[0].properties.name).toBe('Paris')
  })

  it('filters by lat/lon/radius — larger radius includes multiple cities', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    // ~500km radius from a central point should include Paris and Lyon
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?lat=47.0&lon=3.5&radius=500000',
    })
    await app.close()

    const body = response.json()
    expect(body.numberMatched).toBeGreaterThanOrEqual(2)
    const names = body.features.map((f: { properties: { name: string } }) => f.properties.name)
    expect(names).toContain('Paris')
    expect(names).toContain('Lyon')
  })

  it('returns 400 for invalid lat/lon', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?lat=999&lon=2.35',
    })
    await app.close()

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toContain('lat')
  })

  it('returns 400 when radius is given without lat/lon', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?radius=5000',
    })
    await app.close()

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toContain('lat and lon')
  })

  it('preserves lat/lon/radius in pagination links', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:sites/items?lat=47.0&lon=3.5&radius=500000&limit=1',
    })
    await app.close()

    const body = response.json()
    for (const link of body.links) {
      expect(link.href).toContain('lat=')
      expect(link.href).toContain('lon=')
      expect(link.href).toContain('radius=')
    }
  })

  it('returns 404 for unknown collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/collections/foo:bar/items' })
    await app.close()

    expect(response.statusCode).toBe(404)
  })
})

describe('GET /collections/:collectionId/items — datetime filter', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    await db.query(
      `INSERT INTO sanson_workspaces (id, name)
       VALUES ('00000000-0000-0000-0000-000000000030', 'test')`,
    )

    await db.query(`
      CREATE TABLE test_events (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        event_date TIMESTAMPTZ,
        geom GEOMETRY(Point, 4326)
      )
    `)
    await db.query(`CREATE INDEX idx_test_events_geom ON test_events USING GIST (geom)`)
    await db.query(`
      INSERT INTO test_events (name, event_date, geom) VALUES
        ('Event A', '2024-01-15T10:00:00Z', ST_SetSRID(ST_MakePoint(2.35, 48.86), 4326)),
        ('Event B', '2024-06-20T14:00:00Z', ST_SetSRID(ST_MakePoint(4.83, 45.76), 4326)),
        ('Event C', '2025-03-01T09:00:00Z', ST_SetSRID(ST_MakePoint(5.37, 43.30), 4326))
    `)

    await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, table_name, geometry_column, id_column, datetime_column, srid)
       VALUES ('00000000-0000-0000-0000-000000000030', 'events', 'test_events', 'geom', 'id', 'event_date', 4326)`,
    )

    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('filters by datetime instant', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:events/items?datetime=2024-01-15',
    })
    await app.close()

    const body = response.json()
    expect(body.numberMatched).toBe(1)
    expect(body.features[0].properties.name).toBe('Event A')
  })

  it('filters by datetime interval', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:events/items?datetime=2024-01-01/2024-12-31',
    })
    await app.close()

    const body = response.json()
    expect(body.numberMatched).toBe(2)
    const names = body.features.map((f: { properties: { name: string } }) => f.properties.name)
    expect(names).toContain('Event A')
    expect(names).toContain('Event B')
  })

  it('filters by open-ended interval (..)', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:events/items?datetime=2025-01-01/..',
    })
    await app.close()

    const body = response.json()
    expect(body.numberMatched).toBe(1)
    expect(body.features[0].properties.name).toBe('Event C')
  })

  it('returns 400 when collection has no datetime column', async () => {
    // Use the 'test:sites' collection from another describe if available,
    // or create a layer without datetime_column
    const db = new Pool({ connectionString: container.getConnectionUri() })

    await db.query(`
      CREATE TABLE IF NOT EXISTS test_nodatetime (
        id SERIAL PRIMARY KEY,
        geom GEOMETRY(Point, 4326)
      )
    `)
    await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, table_name, geometry_column, id_column, srid)
       VALUES ('00000000-0000-0000-0000-000000000030', 'nodatetime', 'test_nodatetime', 'geom', 'id', 4326)
       ON CONFLICT DO NOTHING`,
    )

    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:nodatetime/items?datetime=2024-01-01',
    })
    await app.close()

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toContain('datetime column')
  })
})

describe('GET /collections/:collectionId/tiles/:z/:x/:y.pbf', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    await db.query(
      `INSERT INTO sanson_workspaces (id, name)
       VALUES ('00000000-0000-0000-0000-000000000040', 'test')`,
    )

    await db.query(`
      CREATE TABLE test_tiles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        geom GEOMETRY(Point, 4326)
      )
    `)
    await db.query(`CREATE INDEX idx_test_tiles_geom ON test_tiles USING GIST (geom)`)
    await db.query(`
      INSERT INTO test_tiles (name, geom) VALUES
        ('Paris',     ST_SetSRID(ST_MakePoint(2.35, 48.86), 4326)),
        ('Lyon',      ST_SetSRID(ST_MakePoint(4.83, 45.76), 4326)),
        ('Marseille', ST_SetSRID(ST_MakePoint(5.37, 43.30), 4326))
    `)

    await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, table_name, geometry_column, id_column, srid)
       VALUES ('00000000-0000-0000-0000-000000000040', 'tiles', 'test_tiles', 'geom', 'id', 4326)`,
    )

    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('returns a non-empty MVT tile covering France', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    // z=5, x=16, y=11 covers France
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:tiles/tiles/5/16/11.pbf',
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/vnd.mapbox-vector-tile')
    expect(response.headers['cache-control']).toContain('max-age=3600')
    expect(response.rawPayload.length).toBeGreaterThan(0)
  })

  it('returns 204 for an empty tile (no features in area)', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    // z=5, x=0, y=0 covers north-west Atlantic — no features
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:tiles/tiles/5/0/0.pbf',
    })
    await app.close()

    expect(response.statusCode).toBe(204)
  })

  it('returns 404 for unknown collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/foo:bar/tiles/5/16/11.pbf',
    })
    await app.close()

    expect(response.statusCode).toBe(404)
  })

  it('returns 400 for invalid tile coordinates', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/test:tiles/tiles/99/0/0.pbf',
    })
    await app.close()

    expect(response.statusCode).toBe(400)
  })
})

describe('exposed_fields filtering', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    await db.query(
      `INSERT INTO sanson_workspaces (id, name)
       VALUES ('00000000-0000-0000-0000-000000000050', 'exposed')`,
    )

    await db.query(`
      CREATE TABLE test_exposed (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        population INTEGER,
        secret_code VARCHAR(50),
        geom GEOMETRY(Point, 4326)
      )
    `)
    await db.query(`CREATE INDEX idx_test_exposed_geom ON test_exposed USING GIST (geom)`)
    await db.query(`
      INSERT INTO test_exposed (name, population, secret_code, geom) VALUES
        ('Paris',     2161000, 'SEC-75', ST_SetSRID(ST_MakePoint(2.35, 48.86), 4326)),
        ('Lyon',       522969, 'SEC-69', ST_SetSRID(ST_MakePoint(4.83, 45.76), 4326))
    `)

    // Layer WITHOUT exposed_fields (null) — should expose all columns
    await db.query(
      `INSERT INTO sanson_layers (id, workspace_id, name, table_name, geometry_column, id_column, srid)
       VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000050', 'all_fields', 'test_exposed', 'geom', 'id', 4326)`,
    )

    // Layer WITH exposed_fields — only name (aliased to "city") and population
    await db.query(
      `INSERT INTO sanson_layers (id, workspace_id, name, table_name, geometry_column, id_column, srid, exposed_fields)
       VALUES ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000050', 'limited_fields', 'test_exposed', 'geom', 'id', 4326,
               $1)`,
      [JSON.stringify([{ source: 'name', alias: 'city' }, { source: 'population' }])],
    )

    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('exposes all columns when exposed_fields is null', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/exposed:all_fields/items',
    })
    await app.close()

    const body = response.json()
    expect(response.statusCode).toBe(200)
    const props = body.features[0].properties
    expect(props).toHaveProperty('name')
    expect(props).toHaveProperty('population')
    expect(props).toHaveProperty('secret_code')
  })

  it('filters properties when exposed_fields is set', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/exposed:limited_fields/items',
    })
    await app.close()

    const body = response.json()
    expect(response.statusCode).toBe(200)
    const props = body.features[0].properties
    // "name" is aliased to "city"
    expect(props).toHaveProperty('city')
    expect(props).toHaveProperty('population')
    // secret_code should NOT be exposed
    expect(props).not.toHaveProperty('secret_code')
    expect(props).not.toHaveProperty('name')
  })

  it('applies aliases in single feature endpoint', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/exposed:limited_fields/items/1',
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.properties).toHaveProperty('city')
    expect(body.properties).not.toHaveProperty('secret_code')
  })

  it('filters queryables based on exposed_fields', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/exposed:limited_fields/queryables',
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    // Should have geometry + city + population
    expect(body.properties).toHaveProperty('geometry')
    expect(body.properties).toHaveProperty('city')
    expect(body.properties).toHaveProperty('population')
    // secret_code and original "name" should NOT appear
    expect(body.properties).not.toHaveProperty('secret_code')
    expect(body.properties).not.toHaveProperty('name')
  })

  it('returns all queryables when exposed_fields is null', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/exposed:all_fields/queryables',
    })
    await app.close()

    const body = response.json()
    expect(body.properties).toHaveProperty('name')
    expect(body.properties).toHaveProperty('population')
    expect(body.properties).toHaveProperty('secret_code')
  })
})

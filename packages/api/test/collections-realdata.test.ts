import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildApp } from '../src/app'

const initSql = readFileSync(join(__dirname, '../../../scripts/init.sql'), 'utf-8')
const geojson = JSON.parse(
  readFileSync(
    join(__dirname, '../../../data/centrales-de-production-nucleaire-edf.geojson'),
    'utf-8',
  ),
)

describe('GET /collections/:collectionId/items — real data (nuclear plants)', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    // Create workspace + data table
    await db.query(
      `INSERT INTO sanson_workspaces (id, name)
       VALUES ('00000000-0000-0000-0000-000000000030', 'energie')`,
    )

    await db.query(`
      CREATE TABLE energie_centrales (
        id SERIAL PRIMARY KEY,
        centrale VARCHAR(100),
        tranche VARCHAR(100),
        commune VARCHAR(100),
        departement VARCHAR(100),
        region VARCHAR(100),
        puissance_installee INTEGER,
        date_mise_en_service DATE,
        geom GEOMETRY(Point, 4326)
      )
    `)
    await db.query(`CREATE INDEX idx_energie_centrales_geom ON energie_centrales USING GIST (geom)`)

    // Load features from GeoJSON
    for (const feature of geojson.features) {
      const p = feature.properties
      await db.query(
        `INSERT INTO energie_centrales (centrale, tranche, commune, departement, region, puissance_installee, date_mise_en_service, geom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_GeomFromGeoJSON($8), 4326))`,
        [
          p.centrale,
          p.tranche,
          p.commune,
          p.departement,
          p.region,
          p.puissance_installee,
          p.date_de_mise_en_service_industrielle,
          JSON.stringify(feature.geometry),
        ],
      )
    }

    // Register the layer
    await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, description, table_name, geometry_column, id_column, srid)
       VALUES ('00000000-0000-0000-0000-000000000030', 'centrales', 'EDF nuclear power plants', 'energie_centrales', 'geom', 'id', 4326)`,
    )

    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('returns all 56 features', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/energie:centrales/items?limit=100',
    })
    await app.close()

    const body = response.json()
    expect(body.type).toBe('FeatureCollection')
    expect(body.numberMatched).toBe(56)
    expect(body.features).toHaveLength(56)
  })

  it('paginates correctly through all features', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)

    // First page
    const page1 = await app.inject({
      method: 'GET',
      url: '/collections/energie:centrales/items?limit=25',
    })
    const body1 = page1.json()
    expect(body1.features).toHaveLength(25)
    expect(body1.numberMatched).toBe(56)
    expect(body1.links.find((l: { rel: string }) => l.rel === 'next')).toBeDefined()

    // Second page
    const page2 = await app.inject({
      method: 'GET',
      url: '/collections/energie:centrales/items?limit=25&offset=25',
    })
    const body2 = page2.json()
    expect(body2.features).toHaveLength(25)
    expect(body2.links.find((l: { rel: string }) => l.rel === 'prev')).toBeDefined()

    // Third page (last)
    const page3 = await app.inject({
      method: 'GET',
      url: '/collections/energie:centrales/items?limit=25&offset=50',
    })
    const body3 = page3.json()
    expect(body3.features).toHaveLength(6)
    expect(body3.links.find((l: { rel: string }) => l.rel === 'next')).toBeUndefined()

    // No duplicate IDs across pages
    const allIds = [
      ...body1.features.map((f: { id: number }) => f.id),
      ...body2.features.map((f: { id: number }) => f.id),
      ...body3.features.map((f: { id: number }) => f.id),
    ]
    expect(new Set(allIds).size).toBe(56)

    await app.close()
  })

  it('filters by bbox — only plants in the south-east', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    // bbox roughly covering south-east France (Rhône valley)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/energie:centrales/items?bbox=4,43,6,46&limit=100',
    })
    await app.close()

    const body = response.json()
    expect(body.numberMatched).toBeGreaterThan(0)
    expect(body.numberMatched).toBeLessThan(56)

    // All returned features should have coordinates within the bbox
    for (const feature of body.features) {
      const [lon, lat] = feature.geometry.coordinates
      expect(lon).toBeGreaterThanOrEqual(4)
      expect(lon).toBeLessThanOrEqual(6)
      expect(lat).toBeGreaterThanOrEqual(43)
      expect(lat).toBeLessThanOrEqual(46)
    }
  })

  it('returns features with expected properties', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/energie:centrales/items?limit=1',
    })
    await app.close()

    const feature = response.json().features[0]
    expect(feature.type).toBe('Feature')
    expect(feature.id).toBeDefined()
    expect(feature.geometry.type).toBe('Point')
    expect(feature.geometry.coordinates).toHaveLength(2)
    expect(feature.properties.centrale).toBeDefined()
    expect(feature.properties.tranche).toBeDefined()
    expect(feature.properties.commune).toBeDefined()
    expect(feature.properties.departement).toBeDefined()
    expect(feature.properties.puissance_installee).toBeDefined()
  })

  it('returns a single feature by ID', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/energie:centrales/items/1',
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.type).toBe('Feature')
    expect(body.id).toBe(1)
    expect(body.geometry.type).toBe('Point')
    expect(body.properties.centrale).toBeDefined()
    expect(body.links.find((l: { rel: string }) => l.rel === 'self')).toBeDefined()
    expect(body.links.find((l: { rel: string }) => l.rel === 'collection')).toBeDefined()
  })

  it('returns 404 for unknown feature ID', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/energie:centrales/items/9999',
    })
    await app.close()

    expect(response.statusCode).toBe(404)
  })
})

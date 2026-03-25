import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildApp } from '../src/app'

// Tile matrix sets endpoints don't need a real DB
const dummyDb = { end: async () => {} } as unknown as Pool

describe('GET /tileMatrixSets', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = buildApp(dummyDb)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns the list of tile matrix sets', async () => {
    const response = await app.inject({ method: 'GET', url: '/tileMatrixSets' })
    expect(response.statusCode).toBe(200)

    const body = response.json()
    expect(body.tileMatrixSets).toHaveLength(1)
    expect(body.tileMatrixSets[0].id).toBe('WebMercatorQuad')
    expect(body.tileMatrixSets[0].crs).toContain('3857')
  })
})

describe('GET /tileMatrixSets/:id', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = buildApp(dummyDb)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns WebMercatorQuad definition', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tileMatrixSets/WebMercatorQuad',
    })
    expect(response.statusCode).toBe(200)

    const body = response.json()
    expect(body.id).toBe('WebMercatorQuad')
    expect(body.crs).toContain('3857')
    expect(body.tileMatrices).toBeInstanceOf(Array)
    expect(body.tileMatrices.length).toBeGreaterThan(0)

    // Zoom 0 should be a single tile
    const z0 = body.tileMatrices[0]
    expect(z0.id).toBe('0')
    expect(z0.matrixWidth).toBe(1)
    expect(z0.matrixHeight).toBe(1)
    expect(z0.tileWidth).toBe(256)
    expect(z0.tileHeight).toBe(256)

    // Zoom 1 should be 2x2
    const z1 = body.tileMatrices[1]
    expect(z1.id).toBe('1')
    expect(z1.matrixWidth).toBe(2)
    expect(z1.matrixHeight).toBe(2)
  })

  it('returns 404 for unknown tile matrix set', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tileMatrixSets/UnknownTMS',
    })
    expect(response.statusCode).toBe(404)
  })
})

const initSql = readFileSync(join(__dirname, '../../../scripts/init.sql'), 'utf-8')

describe('GET /collections/:collectionId/tiles', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)
    await db.query(
      `INSERT INTO sanson_workspaces (id, name) VALUES ('00000000-0000-0000-0000-000000000080', 'tilews')`,
    )
    await db.query(`
      CREATE TABLE data_tilelayer (id SERIAL PRIMARY KEY, geom GEOMETRY(Point, 4326), name TEXT)
    `)
    await db.query(
      `INSERT INTO sanson_collections (workspace_id, name, table_name, srid, bbox)
       VALUES ('00000000-0000-0000-0000-000000000080', 'tilelayer', 'data_tilelayer', 4326,
               '[-5.1, 41.3, 9.6, 51.1]'::jsonb)`,
    )
    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('returns tileset metadata for a collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/tilews:tilelayer/tiles',
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.title).toBe('tilelayer')
    expect(body.dataType).toBe('vector')
    expect(body.tileMatrixSetId).toBe('WebMercatorQuad')
    expect(body.boundingBox).toBeDefined()
    expect(body.boundingBox.lowerLeft).toEqual([-5.1, 41.3])
    expect(body.boundingBox.upperRight).toEqual([9.6, 51.1])

    const rels = body.links.map((l: { rel: string }) => l.rel)
    expect(rels).toContain('self')
    expect(rels).toContain('item')
    expect(rels).toContain('tiling-scheme')
    expect(rels).toContain('collection')
  })

  it('returns 404 for unknown collection', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)
    const response = await app.inject({
      method: 'GET',
      url: '/collections/unknown:nope/tiles',
    })
    await app.close()

    expect(response.statusCode).toBe(404)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'
import FormData from 'form-data'
import { buildApp } from '../../src/app'

const initSql = readFileSync(join(__dirname, '../../../../scripts/init.sql'), 'utf-8')
const geojsonPath = join(
  __dirname,
  '../../../../data/centrales-de-production-nucleaire-edf.geojson',
)
const geojsonBuffer = readFileSync(geojsonPath)

describe('POST /api/admin/import', () => {
  let container: StartedPostgreSqlContainer
  let workspaceId: string

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start()
    const db = new Pool({ connectionString: container.getConnectionUri() })
    await db.query(initSql)

    // Get the default workspace ID
    const { rows } = await db.query("SELECT id FROM sanson_workspaces WHERE name = 'default'")
    workspaceId = rows[0].id
    await db.end()
  })

  afterAll(async () => {
    await container.stop()
  })

  it('imports a GeoJSON file and creates a layer', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)

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

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.feature_count).toBe(56)
    expect(body.geometry_type).toBe('Point')
    expect(body.collection_id).toBe('default:centrales')
    expect(body.bbox).toHaveLength(4)
    expect(body.srid).toBe(4326)
  })

  it('features are accessible via OGC collections API after import', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)

    // Collection should exist
    const colResponse = await app.inject({
      method: 'GET',
      url: '/collections/default:centrales',
    })
    expect(colResponse.statusCode).toBe(200)
    expect(colResponse.json().id).toBe('default:centrales')

    // Items should be accessible
    const itemsResponse = await app.inject({
      method: 'GET',
      url: '/collections/default:centrales/items?limit=5',
    })
    expect(itemsResponse.statusCode).toBe(200)
    const items = itemsResponse.json()
    expect(items.numberMatched).toBe(56)
    expect(items.features).toHaveLength(5)
    expect(items.features[0].geometry.type).toBe('Point')

    // Single feature should be accessible
    const fid = items.features[0].id
    const featureResponse = await app.inject({
      method: 'GET',
      url: `/collections/default:centrales/items/${fid}`,
    })
    expect(featureResponse.statusCode).toBe(200)
    expect(featureResponse.json().type).toBe('Feature')

    await app.close()
  })

  it('records import in history table', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })

    const { rows } = await db.query(
      `SELECT source_file, feature_count, status, duration_ms
       FROM sanson_import_history
       WHERE source_file = 'centrales'
       ORDER BY created_at DESC LIMIT 1`,
    )
    await db.end()

    expect(rows).toHaveLength(1)
    expect(rows[0].feature_count).toBe('56')
    expect(rows[0].status).toBe('completed')
    expect(rows[0].duration_ms).toBeGreaterThan(0)
  })

  it('returns 400 for missing fields', async () => {
    const db = new Pool({ connectionString: container.getConnectionUri() })
    const app = buildApp(db)

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
    const app = buildApp(db)

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

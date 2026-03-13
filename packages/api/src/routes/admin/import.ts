import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

interface ImportRouteOptions {
  db: Pool
}

interface GeoJsonFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown>
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

function inferSqlType(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'DOUBLE PRECISION'
  }
  if (typeof value === 'boolean') return 'BOOLEAN'
  return 'TEXT'
}

function sanitizeColumnName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
}

export async function adminImportRoutes(
  app: FastifyInstance,
  options: ImportRouteOptions,
): Promise<void> {
  // POST /api/admin/import
  app.post('/api/admin/import', {
    schema: {
      tags: ['Admin'],
      summary: 'Import a GeoJSON file',
      description: 'Synchronous import of a GeoJSON file into a new or existing layer',
      consumes: ['multipart/form-data'],
    },
    handler: async (request, reply) => {
      const parts = request.parts()

      let workspaceId: string | undefined
      let layerName: string | undefined
      let srid = 4326
      let geojson: GeoJsonFeatureCollection | undefined

      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname === 'workspace_id') workspaceId = part.value as string
          if (part.fieldname === 'layer_name') layerName = part.value as string
          if (part.fieldname === 'srid') srid = parseInt(part.value as string, 10) || 4326
        } else if (part.type === 'file' && part.fieldname === 'file') {
          const buffer = await part.toBuffer()
          geojson = JSON.parse(buffer.toString('utf-8'))
        }
      }

      if (!workspaceId || !layerName || !geojson) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Missing required fields: workspace_id, layer_name, file',
        }
      }

      if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'File must be a GeoJSON FeatureCollection',
        }
      }

      if (geojson.features.length === 0) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'FeatureCollection has no features',
        }
      }

      // Verify workspace exists
      const { rows: wsRows } = await options.db.query(
        'SELECT id FROM sanson_workspaces WHERE id = $1',
        [workspaceId],
      )
      if (wsRows.length === 0) {
        reply.status(400)
        return { statusCode: 400, error: 'Bad Request', message: 'Workspace not found' }
      }

      // Detect geometry type from first feature
      const geometryType = geojson.features[0].geometry.type

      // Detect columns from first feature properties
      const firstProps = geojson.features[0].properties || {}
      const columns = Object.entries(firstProps).map(([key, value]) => ({
        name: sanitizeColumnName(key),
        originalName: key,
        type: inferSqlType(value),
      }))

      // Build table name
      const tableName = `data_${sanitizeColumnName(layerName)}`

      // Create table
      const columnDefs = columns.map((c) => `${c.name} ${c.type}`).join(', ')
      await options.db.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          geom GEOMETRY(${geometryType}, ${srid})
          ${columnDefs ? ', ' + columnDefs : ''}
        )
      `)

      // Create spatial index
      await options.db.query(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_geom ON ${tableName} USING GIST (geom)`,
      )

      // Insert features in batches
      let insertedCount = 0
      for (const feature of geojson.features) {
        const props = feature.properties || {}
        const colNames = columns.map((c) => c.name)
        const colValues = columns.map((c) => props[c.originalName] ?? null)
        const placeholders = columns.map((_, i) => `$${i + 2}`)

        await options.db.query(
          `INSERT INTO ${tableName} (geom, ${colNames.join(', ')})
           VALUES (ST_SetSRID(ST_GeomFromGeoJSON($1), ${srid}), ${placeholders.join(', ')})`,
          [JSON.stringify(feature.geometry), ...colValues],
        )
        insertedCount++
      }

      // Compute bbox
      const { rows: bboxRows } = await options.db.query(
        `SELECT ST_Extent(ST_Transform(geom, 4326))::text AS bbox FROM ${tableName}`,
      )
      let bbox: number[] | null = null
      if (bboxRows[0]?.bbox) {
        // Parse "BOX(minLon minLat,maxLon maxLat)"
        const match = bboxRows[0].bbox.match(/BOX\((.+?) (.+?),(.+?) (.+?)\)/)
        if (match) {
          bbox = [
            parseFloat(match[1]),
            parseFloat(match[2]),
            parseFloat(match[3]),
            parseFloat(match[4]),
          ]
        }
      }

      // Register or update layer
      const { rows: existingLayer } = await options.db.query(
        'SELECT id FROM sanson_layers WHERE workspace_id = $1 AND name = $2',
        [workspaceId, layerName],
      )

      let layerId: string
      if (existingLayer.length > 0) {
        layerId = existingLayer[0].id
        await options.db.query(
          `UPDATE sanson_layers
           SET bbox = $2, feature_count = $3, geometry_type = $4, updated_at = now()
           WHERE id = $1`,
          [layerId, JSON.stringify(bbox), insertedCount, geometryType],
        )
      } else {
        const { rows: newLayer } = await options.db.query(
          `INSERT INTO sanson_layers (workspace_id, name, table_name, geometry_column, id_column, srid, bbox, feature_count, geometry_type)
           VALUES ($1, $2, $3, 'geom', 'id', $4, $5, $6, $7)
           RETURNING id`,
          [
            workspaceId,
            layerName,
            tableName,
            srid,
            JSON.stringify(bbox),
            insertedCount,
            geometryType,
          ],
        )
        layerId = newLayer[0].id
      }

      reply.status(201)
      return {
        layer_id: layerId,
        collection_id: `${(await options.db.query('SELECT name FROM sanson_workspaces WHERE id = $1', [workspaceId])).rows[0].name}:${layerName}`,
        table_name: tableName,
        feature_count: insertedCount,
        geometry_type: geometryType,
        bbox,
        srid,
      }
    },
  })
}

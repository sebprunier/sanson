import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

interface LayersRouteOptions {
  db: Pool
}

interface LayerRow {
  id: string
  workspace_id: string
  workspace_name: string
  name: string
  description: string | null
  attribution: string | null
  table_name: string
  geometry_column: string
  geometry_type: string | null
  id_column: string
  datetime_column: string | null
  srid: number
  bbox: number[] | null
  feature_count: number | null
  created_at: string
  updated_at: string
}

interface CreateLayerBody {
  workspace_id: string
  name: string
  description?: string
  attribution?: string
  table_name: string
  geometry_column?: string
  geometry_type?: string
  id_column?: string
  srid?: number
}

interface UpdateLayerBody {
  workspace_id?: string
  name?: string
  description?: string
  attribution?: string
  datetime_column?: string | null
  geometry_column?: string
  geometry_type?: string
  id_column?: string
  srid?: number
}

const layerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    workspace_id: { type: 'string' },
    workspace_name: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    attribution: { type: 'string', nullable: true },
    table_name: { type: 'string' },
    geometry_column: { type: 'string' },
    geometry_type: { type: 'string', nullable: true },
    id_column: { type: 'string' },
    datetime_column: { type: 'string', nullable: true },
    srid: { type: 'integer' },
    bbox: { type: 'array', nullable: true, items: { type: 'number' } },
    feature_count: { type: 'integer', nullable: true },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
} as const

const LAYER_SELECT = `
  SELECT l.id, l.workspace_id, w.name AS workspace_name, l.name, l.description, l.attribution,
         l.table_name, l.geometry_column, l.geometry_type, l.id_column, l.datetime_column, l.srid,
         l.bbox, l.feature_count, l.created_at, l.updated_at
  FROM sanson_layers l
  JOIN sanson_workspaces w ON w.id = l.workspace_id
`

export async function adminLayersRoutes(
  app: FastifyInstance,
  options: LayersRouteOptions,
): Promise<void> {
  // GET /api/admin/layers
  app.get<{ Querystring: { workspace_id?: string } }>('/api/admin/layers', {
    schema: {
      tags: ['Admin'],
      summary: 'List layers',
      querystring: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Filter by workspace' },
        },
      },
      response: { 200: { type: 'array', items: layerSchema } },
    },
    handler: async (request) => {
      if (request.query.workspace_id) {
        const { rows } = await options.db.query<LayerRow>(
          `${LAYER_SELECT} WHERE l.workspace_id = $1 ORDER BY l.name`,
          [request.query.workspace_id],
        )
        return rows
      }
      const { rows } = await options.db.query<LayerRow>(`${LAYER_SELECT} ORDER BY w.name, l.name`)
      return rows
    },
  })

  // GET /api/admin/layers/:id
  app.get<{ Params: { id: string } }>('/api/admin/layers/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Layer details',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: layerSchema },
    },
    handler: async (request, reply) => {
      const { rows } = await options.db.query<LayerRow>(`${LAYER_SELECT} WHERE l.id = $1`, [
        request.params.id,
      ])
      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Layer not found' }
      }
      return rows[0]
    },
  })

  // POST /api/admin/layers
  app.post<{ Body: CreateLayerBody }>('/api/admin/layers', {
    schema: {
      tags: ['Admin'],
      summary: 'Create a layer',
      body: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string' },
          attribution: { type: 'string' },
          table_name: { type: 'string', minLength: 1, maxLength: 200 },
          geometry_column: { type: 'string' },
          geometry_type: { type: 'string' },
          id_column: { type: 'string' },
          srid: { type: 'integer' },
        },
        required: ['workspace_id', 'name', 'table_name'],
      },
      response: { 201: layerSchema },
    },
    handler: async (request, reply) => {
      const b = request.body
      try {
        const { rows } = await options.db.query<{ id: string }>(
          `INSERT INTO sanson_layers (workspace_id, name, description, attribution, table_name, geometry_column, geometry_type, id_column, srid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            b.workspace_id,
            b.name,
            b.description ?? null,
            b.attribution ?? null,
            b.table_name,
            b.geometry_column ?? 'geom',
            b.geometry_type ?? null,
            b.id_column ?? 'id',
            b.srid ?? 4326,
          ],
        )
        // Fetch the full row with workspace name
        const result = await options.db.query<LayerRow>(`${LAYER_SELECT} WHERE l.id = $1`, [
          rows[0].id,
        ])
        reply.status(201)
        return result.rows[0]
      } catch (err: unknown) {
        const pgErr = err as { code?: string }
        if (pgErr.code === '23505') {
          reply.status(409)
          return {
            statusCode: 409,
            error: 'Conflict',
            message: `Layer '${b.name}' already exists in this workspace`,
          }
        }
        if (pgErr.code === '23503') {
          reply.status(400)
          return { statusCode: 400, error: 'Bad Request', message: 'Workspace not found' }
        }
        throw err
      }
    },
  })

  // PUT /api/admin/layers/:id
  app.put<{ Params: { id: string }; Body: UpdateLayerBody }>('/api/admin/layers/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a layer',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', nullable: true },
          attribution: { type: 'string', nullable: true },
          datetime_column: { type: 'string', nullable: true },
          geometry_column: { type: 'string' },
          geometry_type: { type: 'string' },
          id_column: { type: 'string' },
          srid: { type: 'integer' },
        },
      },
      response: { 200: layerSchema },
    },
    handler: async (request, reply) => {
      const b = request.body

      // Build dynamic SET clause — only update fields that are explicitly provided
      const sets: string[] = []
      const params: unknown[] = [request.params.id]
      let idx = 2

      const addField = (col: string, value: unknown) => {
        if (value !== undefined) {
          sets.push(`${col} = $${idx}`)
          params.push(value)
          idx++
        }
      }

      addField('workspace_id', b.workspace_id)
      addField('name', b.name)
      addField('description', b.description)
      addField('attribution', b.attribution)
      addField('datetime_column', b.datetime_column)
      addField('geometry_column', b.geometry_column)
      addField('geometry_type', b.geometry_type)
      addField('id_column', b.id_column)
      addField('srid', b.srid)

      if (sets.length === 0) {
        const result = await options.db.query<LayerRow>(`${LAYER_SELECT} WHERE l.id = $1`, [
          request.params.id,
        ])
        if (result.rows.length === 0) {
          reply.status(404)
          return { statusCode: 404, error: 'Not Found', message: 'Layer not found' }
        }
        return result.rows[0]
      }

      sets.push('updated_at = now()')

      const { rows } = await options.db.query<{ id: string }>(
        `UPDATE sanson_layers SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
        params,
      )
      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Layer not found' }
      }
      const result = await options.db.query<LayerRow>(`${LAYER_SELECT} WHERE l.id = $1`, [
        rows[0].id,
      ])
      return result.rows[0]
    },
  })

  // GET /api/admin/layers/:id/schema
  app.get<{ Params: { id: string } }>('/api/admin/layers/:id/schema', {
    schema: {
      tags: ['Admin'],
      summary: 'Layer schema with column statistics',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      const { rows: layerRows } = await options.db.query<LayerRow>(
        `${LAYER_SELECT} WHERE l.id = $1`,
        [request.params.id],
      )
      if (layerRows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Layer not found' }
      }
      const layer = layerRows[0]

      // Get columns from information_schema
      const { rows: columns } = await options.db.query<{
        column_name: string
        data_type: string
        is_nullable: string
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = $1
         ORDER BY ordinal_position`,
        [layer.table_name],
      )

      // Build stats query for each non-geometry column
      const statColumns = columns.filter((c) => c.column_name !== layer.geometry_column)
      const statExpressions = statColumns.map((c) => {
        const col = `"${c.column_name}"`
        return `
          COUNT(${col}) AS "${c.column_name}__non_null",
          COUNT(DISTINCT ${col}) AS "${c.column_name}__distinct",
          MIN(${col}::text) AS "${c.column_name}__min",
          MAX(${col}::text) AS "${c.column_name}__max"`
      })

      let statsRow: Record<string, unknown> = {}
      if (statExpressions.length > 0) {
        const totalCountExpr = `COUNT(*) AS total_count`
        const { rows } = await options.db.query(
          `SELECT ${totalCountExpr}, ${statExpressions.join(',')} FROM ${layer.table_name}`,
        )
        statsRow = rows[0] ?? {}
      }

      const totalCount = Number(statsRow.total_count ?? 0)

      const result = columns.map((c) => {
        const isGeom = c.column_name === layer.geometry_column
        const base = {
          column: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
        }
        if (isGeom) {
          return { ...base, geometry_type: layer.geometry_type, srid: layer.srid }
        }
        const nonNull = Number(statsRow[`${c.column_name}__non_null`] ?? 0)
        return {
          ...base,
          non_null: nonNull,
          null_count: totalCount - nonNull,
          distinct: Number(statsRow[`${c.column_name}__distinct`] ?? 0),
          min: statsRow[`${c.column_name}__min`] ?? null,
          max: statsRow[`${c.column_name}__max`] ?? null,
        }
      })

      return { total_count: totalCount, columns: result }
    },
  })

  // GET /api/admin/layers/:id/history
  app.get<{ Params: { id: string } }>('/api/admin/layers/:id/history', {
    schema: {
      tags: ['Admin'],
      summary: 'Import history for a layer',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      // Verify layer exists
      const { rows: layerRows } = await options.db.query(
        'SELECT id FROM sanson_layers WHERE id = $1',
        [request.params.id],
      )
      if (layerRows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Layer not found' }
      }

      const { rows } = await options.db.query(
        `SELECT id, source_file, source_srid, target_srid, feature_count,
                total_features, imported_features, progress,
                status, error, duration_ms, created_at, started_at, completed_at
         FROM sanson_import_history
         WHERE layer_id = $1
         ORDER BY created_at DESC`,
        [request.params.id],
      )
      return rows
    },
  })

  // GET /api/admin/layers/:id/export
  app.get<{ Params: { id: string } }>('/api/admin/layers/:id/export', {
    schema: {
      tags: ['Admin'],
      summary: 'Export layer as GeoJSON file',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      const { rows: layerRows } = await options.db.query<LayerRow>(
        `${LAYER_SELECT} WHERE l.id = $1`,
        [request.params.id],
      )
      if (layerRows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Layer not found' }
      }
      const layer = layerRows[0]

      const geomExpr =
        layer.srid === 4326 ? layer.geometry_column : `ST_Transform(${layer.geometry_column}, 4326)`

      const { rows: features } = await options.db.query<{
        id: number
        geojson: object
        properties: Record<string, unknown>
      }>(
        `SELECT ${layer.id_column} AS id,
                ST_AsGeoJSON(${geomExpr})::json AS geojson,
                to_jsonb(t.*) - '${layer.id_column}' - '${layer.geometry_column}' AS properties
         FROM ${layer.table_name} t
         ORDER BY ${layer.id_column}`,
      )

      const featureCollection = {
        type: 'FeatureCollection',
        features: features.map((f) => ({
          type: 'Feature',
          id: f.id,
          geometry: f.geojson,
          properties: f.properties,
        })),
      }

      const filename = `${layer.workspace_name}_${layer.name}.geojson`
      reply.header('Content-Type', 'application/geo+json')
      reply.header('Content-Disposition', `attachment; filename="${filename}"`)
      return featureCollection
    },
  })

  // DELETE /api/admin/layers/:id
  app.delete<{ Params: { id: string } }>('/api/admin/layers/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete a layer',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      // Fetch layer to get table_name before deleting
      const { rows } = await options.db.query<{ table_name: string }>(
        'SELECT table_name FROM sanson_layers WHERE id = $1',
        [request.params.id],
      )
      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Layer not found' }
      }

      const tableName = rows[0].table_name

      // Delete layer (cascades to import_history)
      await options.db.query('DELETE FROM sanson_layers WHERE id = $1', [request.params.id])

      // Drop the data table
      await options.db.query(`DROP TABLE IF EXISTS ${tableName}`)

      reply.status(204)
    },
  })
}

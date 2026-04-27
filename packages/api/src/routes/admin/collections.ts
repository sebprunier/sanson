import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { parseCql2Text } from '@sanson/core'

interface CollectionsRouteOptions {
  db: Pool
}

interface CollectionRow {
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
  exposed_fields: ExposedField[] | null
  style: StyleConfig | null
  default_center_lon: number | null
  default_center_lat: number | null
  default_zoom: number | null
  srid: number
  bbox: number[] | null
  feature_count: number | null
  created_at: string
  updated_at: string
}

interface CreateCollectionBody {
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

interface ExposedField {
  source: string
  alias?: string
}

interface StyleConfig {
  type: 'single' | 'categorized' | 'graduated'
  fill_color?: string
  fill_opacity?: number
  stroke_color?: string
  stroke_width?: number
  circle_radius?: number
  field?: string
  categories?: { value: string | number | boolean; color: string; label?: string }[]
  method?: 'equal_interval' | 'quantile' | 'manual'
  classes?: { min: number; max: number; color: string; label?: string }[]
  default_color?: string
}

interface UpdateCollectionBody {
  workspace_id?: string
  name?: string
  description?: string
  attribution?: string
  datetime_column?: string | null
  exposed_fields?: ExposedField[] | null
  style?: StyleConfig | null
  default_center_lon?: number | null
  default_center_lat?: number | null
  default_zoom?: number | null
  geometry_column?: string
  geometry_type?: string
  id_column?: string
  srid?: number
}

function buildExportPropertiesExpr(collection: CollectionRow): string {
  if (!collection.exposed_fields || collection.exposed_fields.length === 0) {
    return `to_jsonb(t.*) - '${collection.id_column}' - '${collection.geometry_column}'`
  }
  const pairs = collection.exposed_fields
    .map((f) => `'${f.alias ?? f.source}', t."${f.source}"`)
    .join(', ')
  return `jsonb_build_object(${pairs})`
}

const collectionSchema = {
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
    exposed_fields: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: { source: { type: 'string' }, alias: { type: 'string' } },
        required: ['source'],
      },
    },
    style: { type: 'object', nullable: true, additionalProperties: true },
    default_center_lon: { type: 'number', nullable: true },
    default_center_lat: { type: 'number', nullable: true },
    default_zoom: { type: 'number', nullable: true },
    srid: { type: 'integer' },
    bbox: { type: 'array', nullable: true, items: { type: 'number' } },
    feature_count: { type: 'integer', nullable: true },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
} as const

const COLLECTION_SELECT = `
  SELECT c.id, c.workspace_id, w.name AS workspace_name, c.name, c.description, c.attribution,
         c.table_name, c.geometry_column, c.geometry_type, c.id_column, c.datetime_column, c.exposed_fields, c.style,
         c.default_center_lon, c.default_center_lat, c.default_zoom,
         c.srid, c.bbox, c.feature_count, c.created_at, c.updated_at
  FROM sanson_collections c
  JOIN sanson_workspaces w ON w.id = c.workspace_id
`

export async function adminCollectionsRoutes(
  app: FastifyInstance,
  options: CollectionsRouteOptions,
): Promise<void> {
  // GET /api/admin/collections
  app.get<{ Querystring: { workspace_id?: string } }>('/api/admin/collections', {
    schema: {
      tags: ['Admin'],
      summary: 'List collections',
      querystring: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string', description: 'Filter by workspace' },
        },
      },
      response: { 200: { type: 'array', items: collectionSchema } },
    },
    handler: async (request) => {
      if (request.query.workspace_id) {
        const { rows } = await options.db.query<CollectionRow>(
          `${COLLECTION_SELECT} WHERE c.workspace_id = $1 ORDER BY c.name`,
          [request.query.workspace_id],
        )
        return rows
      }
      const { rows } = await options.db.query<CollectionRow>(
        `${COLLECTION_SELECT} ORDER BY w.name, c.name`,
      )
      return rows
    },
  })

  // GET /api/admin/collections/:id
  app.get<{ Params: { id: string } }>('/api/admin/collections/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Collection details',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 200: collectionSchema },
    },
    handler: async (request, reply) => {
      const { rows } = await options.db.query<CollectionRow>(
        `${COLLECTION_SELECT} WHERE c.id = $1`,
        [request.params.id],
      )
      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
      }
      return rows[0]
    },
  })

  // POST /api/admin/collections
  app.post<{ Body: CreateCollectionBody }>('/api/admin/collections', {
    schema: {
      tags: ['Admin'],
      summary: 'Create a collection',
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
      response: { 201: collectionSchema },
    },
    handler: async (request, reply) => {
      const b = request.body
      try {
        const { rows } = await options.db.query<{ id: string }>(
          `INSERT INTO sanson_collections (workspace_id, name, description, attribution, table_name, geometry_column, geometry_type, id_column, srid)
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
        const result = await options.db.query<CollectionRow>(
          `${COLLECTION_SELECT} WHERE c.id = $1`,
          [rows[0].id],
        )
        reply.status(201)
        return result.rows[0]
      } catch (err: unknown) {
        const pgErr = err as { code?: string }
        if (pgErr.code === '23505') {
          reply.status(409)
          return {
            statusCode: 409,
            error: 'Conflict',
            message: `Collection '${b.name}' already exists in this workspace`,
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

  // PUT /api/admin/collections/:id
  app.put<{ Params: { id: string }; Body: UpdateCollectionBody }>('/api/admin/collections/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a collection',
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
          exposed_fields: {
            type: 'array',
            nullable: true,
            items: {
              type: 'object',
              properties: { source: { type: 'string' }, alias: { type: 'string' } },
              required: ['source'],
            },
          },
          style: { type: 'object', nullable: true, additionalProperties: true },
          default_center_lon: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
          default_center_lat: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
          default_zoom: { type: 'number', nullable: true, minimum: 0, maximum: 24 },
          geometry_column: { type: 'string' },
          geometry_type: { type: 'string' },
          id_column: { type: 'string' },
          srid: { type: 'integer' },
        },
      },
      response: { 200: collectionSchema },
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
      if (b.exposed_fields !== undefined) {
        addField('exposed_fields', b.exposed_fields ? JSON.stringify(b.exposed_fields) : null)
      }
      if (b.style !== undefined) {
        addField('style', b.style ? JSON.stringify(b.style) : null)
      }
      addField('default_center_lon', b.default_center_lon)
      addField('default_center_lat', b.default_center_lat)
      addField('default_zoom', b.default_zoom)
      addField('geometry_column', b.geometry_column)
      addField('geometry_type', b.geometry_type)
      addField('id_column', b.id_column)
      addField('srid', b.srid)

      if (sets.length === 0) {
        const result = await options.db.query<CollectionRow>(
          `${COLLECTION_SELECT} WHERE c.id = $1`,
          [request.params.id],
        )
        if (result.rows.length === 0) {
          reply.status(404)
          return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
        }
        return result.rows[0]
      }

      sets.push('updated_at = now()')

      const { rows } = await options.db.query<{ id: string }>(
        `UPDATE sanson_collections SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
        params,
      )
      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
      }
      const result = await options.db.query<CollectionRow>(`${COLLECTION_SELECT} WHERE c.id = $1`, [
        rows[0].id,
      ])
      return result.rows[0]
    },
  })

  // GET /api/admin/collections/:id/schema
  app.get<{ Params: { id: string } }>('/api/admin/collections/:id/schema', {
    schema: {
      tags: ['Admin'],
      summary: 'Collection schema with column statistics',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      const { rows: collectionRows } = await options.db.query<CollectionRow>(
        `${COLLECTION_SELECT} WHERE c.id = $1`,
        [request.params.id],
      )
      if (collectionRows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
      }
      const collection = collectionRows[0]

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
        [collection.table_name],
      )

      // Build stats query for each non-geometry column
      const statColumns = columns.filter((c) => c.column_name !== collection.geometry_column)
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
          `SELECT ${totalCountExpr}, ${statExpressions.join(',')} FROM ${collection.table_name}`,
        )
        statsRow = rows[0] ?? {}
      }

      const totalCount = Number(statsRow.total_count ?? 0)

      const result = columns.map((c) => {
        const isGeom = c.column_name === collection.geometry_column
        const base = {
          column: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
        }
        if (isGeom) {
          return { ...base, geometry_type: collection.geometry_type, srid: collection.srid }
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

  // GET /api/admin/collections/:id/classify
  app.get<{
    Params: { id: string }
    Querystring: { field: string; type: 'categorized' | 'graduated'; classes?: string }
  }>('/api/admin/collections/:id/classify', {
    schema: {
      tags: ['Admin'],
      summary: 'Auto-classify a column for styling',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          type: { type: 'string', enum: ['categorized', 'graduated'] },
          classes: { type: 'string' },
        },
        required: ['field', 'type'],
      },
    },
    handler: async (request, reply) => {
      const { rows: collectionRows } = await options.db.query<CollectionRow>(
        `${COLLECTION_SELECT} WHERE c.id = $1`,
        [request.params.id],
      )
      if (collectionRows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
      }
      const collection = collectionRows[0]
      const { field, type } = request.query

      // Verify the field exists
      const { rows: colRows } = await options.db.query<{
        column_name: string
        data_type: string
      }>(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`,
        [collection.table_name, field],
      )
      if (colRows.length === 0) {
        reply.status(400)
        return { statusCode: 400, error: 'Bad Request', message: `Column '${field}' not found` }
      }

      if (type === 'categorized') {
        const { rows } = await options.db.query<{ value: unknown }>(
          `SELECT DISTINCT "${field}" AS value FROM ${collection.table_name}
           WHERE "${field}" IS NOT NULL ORDER BY "${field}" LIMIT 50`,
        )
        return {
          type: 'categorized',
          field,
          categories: rows.map((r) => ({ value: r.value })),
        }
      }

      // graduated
      const numClasses = Math.min(Math.max(parseInt(request.query.classes ?? '5', 10) || 5, 2), 20)
      const dataType = colRows[0].data_type
      const numericTypes = ['integer', 'bigint', 'smallint', 'double precision', 'real', 'numeric']
      if (!numericTypes.includes(dataType)) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: `Column '${field}' is not numeric (type: ${dataType})`,
        }
      }

      const { rows: statsRows } = await options.db.query<{ min: number; max: number }>(
        `SELECT MIN("${field}")::double precision AS min, MAX("${field}")::double precision AS max
         FROM ${collection.table_name} WHERE "${field}" IS NOT NULL`,
      )
      const { min, max } = statsRows[0]

      // Compute quantile breakpoints
      const fractions = Array.from({ length: numClasses - 1 }, (_, i) => (i + 1) / numClasses)
      const { rows: quantileRows } = await options.db.query<{ breakpoints: number[] }>(
        `SELECT percentile_cont(ARRAY[${fractions.join(',')}])
           WITHIN GROUP (ORDER BY "${field}"::double precision) AS breakpoints
         FROM ${collection.table_name} WHERE "${field}" IS NOT NULL`,
      )
      const breakpoints = quantileRows[0].breakpoints

      // Build classes
      const classes = []
      let prev = min
      for (let i = 0; i < numClasses; i++) {
        const next = i < numClasses - 1 ? breakpoints[i] : max
        classes.push({ min: prev, max: next })
        prev = next
      }

      return {
        type: 'graduated',
        field,
        method: 'quantile',
        classes,
        min,
        max,
      }
    },
  })

  // GET /api/admin/collections/:id/history
  app.get<{ Params: { id: string } }>('/api/admin/collections/:id/history', {
    schema: {
      tags: ['Admin'],
      summary: 'Import history for a collection',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      // Verify collection exists
      const { rows: collectionRows } = await options.db.query(
        'SELECT id FROM sanson_collections WHERE id = $1',
        [request.params.id],
      )
      if (collectionRows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
      }

      const { rows } = await options.db.query(
        `SELECT id, source_file, source_srid, target_srid, feature_count,
                total_features, imported_features, progress,
                status, error, duration_ms, created_at, started_at, completed_at
         FROM sanson_import_history
         WHERE collection_id = $1
         ORDER BY created_at DESC`,
        [request.params.id],
      )
      return rows
    },
  })

  // GET /api/admin/collections/:id/export
  app.get<{
    Params: { id: string }
    Querystring: { filter?: string; bbox?: string; limit?: string; format?: string }
  }>('/api/admin/collections/:id/export', {
    schema: {
      tags: ['Admin'],
      summary: 'Export collection as GeoJSON or CSV file',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'CQL2 text filter expression' },
          bbox: {
            type: 'string',
            description: 'Bounding box filter: minLon,minLat,maxLon,maxLat',
          },
          limit: { type: 'string', description: 'Maximum number of features to export' },
          format: {
            type: 'string',
            enum: ['geojson', 'csv'],
            description: 'Output format (default: geojson)',
          },
        },
      },
    },
    handler: async (request, reply) => {
      const format = request.query.format === 'csv' ? 'csv' : 'geojson'
      const { rows: collectionRows } = await options.db.query<CollectionRow>(
        `${COLLECTION_SELECT} WHERE c.id = $1`,
        [request.params.id],
      )
      if (collectionRows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
      }
      const collection = collectionRows[0]

      const conditions: string[] = []
      const params: unknown[] = []
      let paramIndex = 1

      // CQL2 filter
      if (request.query.filter) {
        const { rows: colRows } = await options.db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = $1 AND column_name NOT IN ($2)`,
          [collection.table_name, collection.geometry_column],
        )
        const cqlResult = parseCql2Text(request.query.filter, {
          allowedColumns: new Set(colRows.map((r) => r.column_name)),
          startParamIndex: paramIndex,
          geometryColumn: collection.geometry_column,
          srid: collection.srid,
        })
        conditions.push(cqlResult.sql)
        params.push(...cqlResult.params)
        paramIndex += cqlResult.params.length
      }

      // Bbox filter
      if (request.query.bbox) {
        const parts = request.query.bbox.split(',').map(Number)
        if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
          conditions.push(
            `${collection.geometry_column} && ST_Transform(ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 4326), ${collection.srid})`,
          )
          params.push(...parts)
          paramIndex += 4
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const limitClause = request.query.limit ? `LIMIT ${parseInt(request.query.limit, 10)}` : ''

      const geomExpr =
        collection.srid === 4326
          ? collection.geometry_column
          : `ST_Transform(${collection.geometry_column}, 4326)`

      const propsExpr = buildExportPropertiesExpr(collection)

      if (format === 'csv') {
        const { rows: csvRows } = await options.db.query<{
          id: number
          geom_wkt: string | null
          properties: Record<string, unknown>
        }>(
          `SELECT ${collection.id_column} AS id,
                  ST_AsText(${geomExpr}) AS geom_wkt,
                  ${propsExpr} AS properties
           FROM ${collection.table_name} t
           ${whereClause}
           ORDER BY ${collection.id_column}
           ${limitClause}`,
          params,
        )

        let propertyKeys: string[] = []
        if (csvRows.length > 0) {
          propertyKeys = Object.keys(csvRows[0].properties ?? {})
        } else if (collection.exposed_fields && collection.exposed_fields.length > 0) {
          propertyKeys = collection.exposed_fields.map((f) => f.alias ?? f.source)
        } else {
          const { rows: colRows } = await options.db.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = $1
               AND column_name <> $2
               AND column_name <> $3
             ORDER BY ordinal_position`,
            [collection.table_name, collection.id_column, collection.geometry_column],
          )
          propertyKeys = colRows.map((r) => r.column_name)
        }

        const headers = ['id', ...propertyKeys, 'geom_wkt']
        const escape = (val: unknown): string => {
          if (val === null || val === undefined) return ''
          const s = typeof val === 'object' ? JSON.stringify(val) : String(val)
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        }

        const lines: string[] = [headers.map(escape).join(',')]
        for (const row of csvRows) {
          const cells: string[] = [escape(row.id)]
          for (const key of propertyKeys) cells.push(escape(row.properties?.[key]))
          cells.push(escape(row.geom_wkt))
          lines.push(cells.join(','))
        }
        const csv = lines.join('\r\n') + '\r\n'

        const filename = `${collection.workspace_name}_${collection.name}.csv`
        reply.header('Content-Type', 'text/csv; charset=utf-8')
        reply.header('Content-Disposition', `attachment; filename="${filename}"`)
        return csv
      }

      const { rows: features } = await options.db.query<{
        id: number
        geojson: object
        properties: Record<string, unknown>
      }>(
        `SELECT ${collection.id_column} AS id,
                ST_AsGeoJSON(${geomExpr})::json AS geojson,
                ${propsExpr} AS properties
         FROM ${collection.table_name} t
         ${whereClause}
         ORDER BY ${collection.id_column}
         ${limitClause}`,
        params,
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

      const filename = `${collection.workspace_name}_${collection.name}.geojson`
      reply.header('Content-Type', 'application/geo+json')
      reply.header('Content-Disposition', `attachment; filename="${filename}"`)
      return featureCollection
    },
  })

  // DELETE /api/admin/collections/:id
  app.delete<{ Params: { id: string } }>('/api/admin/collections/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete a collection',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      // Fetch collection to get table_name before deleting
      const { rows } = await options.db.query<{ table_name: string }>(
        'SELECT table_name FROM sanson_collections WHERE id = $1',
        [request.params.id],
      )
      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
      }

      const tableName = rows[0].table_name

      // Delete collection (cascades to import_history)
      await options.db.query('DELETE FROM sanson_collections WHERE id = $1', [request.params.id])

      // Drop the data table
      await options.db.query(`DROP TABLE IF EXISTS ${tableName}`)

      reply.status(204)
    },
  })
}

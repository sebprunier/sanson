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
  name?: string
  description?: string
  attribution?: string
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
    srid: { type: 'integer' },
    bbox: { type: 'array', nullable: true, items: { type: 'number' } },
    feature_count: { type: 'integer', nullable: true },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
} as const

const LAYER_SELECT = `
  SELECT l.id, l.workspace_id, w.name AS workspace_name, l.name, l.description, l.attribution,
         l.table_name, l.geometry_column, l.geometry_type, l.id_column, l.srid,
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
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string' },
          attribution: { type: 'string' },
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
      const { rows } = await options.db.query<{ id: string }>(
        `UPDATE sanson_layers
           SET name = COALESCE($2, name),
               description = COALESCE($3, description),
               attribution = COALESCE($4, attribution),
               geometry_column = COALESCE($5, geometry_column),
               geometry_type = COALESCE($6, geometry_type),
               id_column = COALESCE($7, id_column),
               srid = COALESCE($8, srid),
               updated_at = now()
           WHERE id = $1
           RETURNING id`,
        [
          request.params.id,
          b.name ?? null,
          b.description ?? null,
          b.attribution ?? null,
          b.geometry_column ?? null,
          b.geometry_type ?? null,
          b.id_column ?? null,
          b.srid ?? null,
        ],
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
      const { rowCount } = await options.db.query('DELETE FROM sanson_layers WHERE id = $1', [
        request.params.id,
      ])
      if (rowCount === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Layer not found' }
      }
      reply.status(204)
    },
  })
}

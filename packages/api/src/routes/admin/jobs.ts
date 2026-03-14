import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

interface JobsRouteOptions {
  db: Pool
}

export async function adminJobsRoutes(
  app: FastifyInstance,
  options: JobsRouteOptions,
): Promise<void> {
  // GET /api/admin/jobs
  app.get<{
    Querystring: { status?: string; layer_id?: string; limit?: string; offset?: string }
  }>('/api/admin/jobs', {
    schema: {
      tags: ['Admin'],
      summary: 'List jobs',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
          layer_id: { type: 'string' },
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
      },
    },
    handler: async (request) => {
      const limit = Math.min(parseInt(request.query.limit ?? '20', 10) || 20, 100)
      const offset = parseInt(request.query.offset ?? '0', 10) || 0

      const conditions: string[] = []
      const values: unknown[] = []
      let idx = 1

      if (request.query.status) {
        conditions.push(`h.status = $${idx++}`)
        values.push(request.query.status)
      }
      if (request.query.layer_id) {
        conditions.push(`h.layer_id = $${idx++}`)
        values.push(request.query.layer_id)
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const { rows } = await options.db.query(
        `SELECT h.id, h.job_id, h.layer_id, l.name AS layer_name,
                h.source_file, h.source_srid, h.target_srid,
                h.feature_count, h.total_features, h.imported_features,
                h.progress, h.status, h.error, h.logs,
                h.duration_ms, h.created_at, h.started_at, h.completed_at
         FROM sanson_import_history h
         LEFT JOIN sanson_layers l ON l.id = h.layer_id
         ${where}
         ORDER BY h.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, limit, offset],
      )

      return rows
    },
  })

  // GET /api/admin/jobs/:id
  app.get<{ Params: { id: string } }>('/api/admin/jobs/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Job details',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      const { rows } = await options.db.query(
        `SELECT h.id, h.job_id, h.layer_id, l.name AS layer_name,
                h.source_file, h.source_srid, h.target_srid,
                h.feature_count, h.total_features, h.imported_features,
                h.progress, h.status, h.error, h.logs,
                h.duration_ms, h.created_at, h.started_at, h.completed_at
         FROM sanson_import_history h
         LEFT JOIN sanson_layers l ON l.id = h.layer_id
         WHERE h.id = $1`,
        [request.params.id],
      )

      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Job not found' }
      }

      return rows[0]
    },
  })
}

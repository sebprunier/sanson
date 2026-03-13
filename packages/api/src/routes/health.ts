import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

interface HealthRouteOptions {
  db: Pool
}

interface HealthResponse {
  status: 'ok' | 'error'
  db: 'ok' | 'error'
}

const healthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'error'] },
    db: { type: 'string', enum: ['ok', 'error'] },
  },
} as const

export async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  app.get<{ Reply: HealthResponse }>('/health', {
    schema: {
      tags: ['Admin'],
      summary: 'Health check',
      description: 'Returns the health status of the server and database',
      response: {
        200: healthResponseSchema,
        503: healthResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      try {
        await options.db.query('SELECT 1')
        return { status: 'ok', db: 'ok' }
      } catch {
        reply.status(503)
        return { status: 'error', db: 'error' }
      }
    },
  })
}

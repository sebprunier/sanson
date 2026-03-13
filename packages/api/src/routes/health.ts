import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

interface HealthRouteOptions {
  db: Pool
}

interface HealthResponse {
  status: 'ok' | 'error'
  db: 'ok' | 'error'
}

export async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  app.get<{ Reply: HealthResponse }>('/health', async (_request, reply) => {
    try {
      await options.db.query('SELECT 1')
      return { status: 'ok', db: 'ok' }
    } catch {
      reply.status(503)
      return { status: 'error', db: 'error' }
    }
  })
}

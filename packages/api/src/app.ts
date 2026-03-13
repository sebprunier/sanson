import Fastify, { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { rootRoutes } from './routes/root.js'
import { healthRoutes } from './routes/health.js'

export function buildApp(db: Pool): FastifyInstance {
  const app = Fastify({ logger: false })

  app.register(rootRoutes)
  app.register(healthRoutes, { db })

  return app
}

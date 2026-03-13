import Fastify, { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { rootRoutes } from './routes/root'
import { conformanceRoutes } from './routes/conformance'
import { healthRoutes } from './routes/health'

interface AppOptions {
  logger?: boolean
}

export function buildApp(db: Pool, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false })

  app.addHook('onClose', async () => {
    await db.end()
  })

  app.register(rootRoutes)
  app.register(conformanceRoutes)
  app.register(healthRoutes, { db })

  return app
}

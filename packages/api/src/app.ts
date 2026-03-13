import Fastify, { FastifyInstance } from 'fastify'
import fastifySwagger from '@fastify/swagger'
import { Pool } from 'pg'
import { rootRoutes } from './routes/root'
import { conformanceRoutes } from './routes/conformance'
import { collectionsRoutes } from './routes/collections'
import { apiRoutes } from './routes/api'
import { adminWorkspacesRoutes } from './routes/admin/workspaces'
import { adminLayersRoutes } from './routes/admin/layers'
import { healthRoutes } from './routes/health'

interface AppOptions {
  logger?: boolean
}

export function buildApp(db: Pool, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false })

  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Sanson',
        description: 'An open source geospatial server — OGC API Features compliant',
        version: '0.1.0',
      },
      tags: [
        { name: 'OGC', description: 'OGC API — Features endpoints' },
        { name: 'Admin', description: 'Administration endpoints' },
      ],
    },
  })

  app.addHook('onClose', async () => {
    await db.end()
  })

  app.register(rootRoutes)
  app.register(conformanceRoutes)
  app.register(collectionsRoutes, { db })
  app.register(adminWorkspacesRoutes, { db })
  app.register(adminLayersRoutes, { db })
  app.register(apiRoutes)
  app.register(healthRoutes, { db })

  return app
}

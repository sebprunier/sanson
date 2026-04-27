import Fastify, { FastifyInstance } from 'fastify'
import fastifySwagger from '@fastify/swagger'
import fastifyStatic from '@fastify/static'
import { Pool } from 'pg'
import PgBoss from 'pg-boss'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { rootRoutes } from './routes/root'
import { conformanceRoutes } from './routes/conformance'
import { collectionsRoutes } from './routes/collections'
import { apiRoutes } from './routes/api'
import multipart from '@fastify/multipart'
import { adminWorkspacesRoutes } from './routes/admin/workspaces'
import { adminCollectionsRoutes } from './routes/admin/collections'
import { adminImportRoutes } from './routes/admin/import'
import { adminPreviewRoutes } from './routes/admin/preview'
import { adminJobsRoutes } from './routes/admin/jobs'
import { adminHealthRoutes } from './routes/admin/health'
import { adminConfigRoutes } from './routes/admin/config'
import { healthRoutes } from './routes/health'
import { tileMatrixSetsRoutes } from './routes/tileMatrixSets'

interface AppOptions {
  logger?: boolean
  boss?: PgBoss
  maxFileSizeMb?: number
  /** Absolute path to the built admin UI (apps/admin/dist). If set and the
   * directory exists, it is served at /admin/* with an SPA fallback. */
  adminUiDir?: string
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

  const maxFileSizeBytes = (options.maxFileSizeMb ?? 1024) * 1024 * 1024
  app.register(multipart, { limits: { fileSize: maxFileSizeBytes } })

  app.addHook('onClose', async () => {
    await db.end()
  })

  app.register(rootRoutes)
  app.register(conformanceRoutes)
  app.register(tileMatrixSetsRoutes)
  app.register(collectionsRoutes, { db })
  app.register(adminWorkspacesRoutes, { db })
  app.register(adminCollectionsRoutes, { db })
  app.register(adminImportRoutes, { db, boss: options.boss })
  app.register(adminPreviewRoutes)
  app.register(adminJobsRoutes, { db })
  app.register(apiRoutes)
  app.register(healthRoutes, { db })
  app.register(adminHealthRoutes, { db })
  app.register(adminConfigRoutes, { db })

  if (options.adminUiDir) {
    const dir = resolve(options.adminUiDir)
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      app.register(fastifyStatic, {
        root: dir,
        prefix: '/admin/',
      })
      // SPA fallback: any /admin/* route that didn't match a file returns index.html
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith('/admin')) {
          return reply.sendFile('index.html')
        }
        reply.status(404).send({ statusCode: 404, error: 'Not Found' })
      })
    }
  }

  return app
}

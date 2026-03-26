import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { getAllConfig, updateConfig } from '../../config'

interface ConfigRouteOptions {
  db: Pool
}

export async function adminConfigRoutes(
  app: FastifyInstance,
  options: ConfigRouteOptions,
): Promise<void> {
  app.get('/api/admin/config', {
    schema: {
      tags: ['Admin'],
      summary: 'Get all configuration values',
    },
    handler: async () => {
      return getAllConfig(options.db)
    },
  })

  app.put('/api/admin/config', {
    schema: {
      tags: ['Admin'],
      summary: 'Update configuration values',
    },
    handler: async (request) => {
      const updates = request.body as Array<{ key: string; value: string }>
      return updateConfig(options.db, updates)
    },
  })
}

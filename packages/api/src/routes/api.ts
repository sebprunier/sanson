import { FastifyInstance } from 'fastify'

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api', {
    schema: {
      tags: ['OGC'],
      summary: 'API definition',
      description: 'OpenAPI 3.0 specification for this server',
      hide: true,
    },
    handler: async () => {
      return app.swagger()
    },
  })
}

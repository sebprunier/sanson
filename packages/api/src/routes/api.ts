import { FastifyInstance } from 'fastify'

/** Minimal view of the OpenAPI document — only the parts we post-process. */
interface OpenApiParameter {
  in?: string
  style?: string
}
interface OpenApiOperation {
  parameters?: OpenApiParameter[]
}
interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation> | undefined>
}

/**
 * Declare `style: form` on every query parameter.
 *
 * `form` is already OpenAPI 3.0's default for query parameters, so this changes
 * nothing semantically. But the OGC CITE suite (ets-ogcapi-features10) asserts
 * the property is *present* rather than defaulted — `limit`, `bbox` and
 * `datetime` each fail its parameter-definition tests otherwise — and Fastify
 * does not emit it. Stamping the served document covers every route at once.
 */
function declareQueryParameterStyle(doc: OpenApiDocument): OpenApiDocument {
  for (const pathItem of Object.values(doc.paths ?? {})) {
    for (const operation of Object.values(pathItem ?? {})) {
      for (const parameter of operation?.parameters ?? []) {
        if (parameter.in === 'query' && parameter.style === undefined) parameter.style = 'form'
      }
    }
  }
  return doc
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api', {
    schema: {
      tags: ['OGC'],
      summary: 'API definition',
      description: 'OpenAPI 3.0 specification for this server',
      hide: true,
    },
    handler: async () => {
      return declareQueryParameterStyle(app.swagger() as OpenApiDocument)
    },
  })
}

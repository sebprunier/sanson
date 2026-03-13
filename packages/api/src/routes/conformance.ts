import { FastifyInstance } from 'fastify'

interface ConformanceDeclaration {
  conformsTo: string[]
}

const conformsTo = [
  'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core',
  'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson',
  'http://www.opengis.net/spec/ogcapi-common/1.0/req/oas30',
  'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter',
  'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/features-filter',
  'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/queryables',
  'http://www.opengis.net/spec/cql2/1.0/req/cql2-text',
  'http://www.opengis.net/spec/cql2/1.0/req/basic-cql2',
  'http://www.opengis.net/spec/cql2/1.0/req/basic-spatial-operators',
  'http://www.opengis.net/spec/cql2/1.0/req/advanced-comparison-operators',
]

export async function conformanceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: ConformanceDeclaration }>('/conformance', async () => {
    return { conformsTo }
  })
}

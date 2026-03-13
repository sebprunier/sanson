import { FastifyInstance } from 'fastify'

interface Link {
  href: string
  rel: string
  type: string
  title: string
}

interface LandingPage {
  title: string
  description: string
  links: Link[]
}

export async function rootRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: LandingPage }>('/', async () => {
    return {
      title: 'Sanson',
      description: 'An open source geospatial server — OGC API Features compliant',
      links: [
        {
          href: '/conformance',
          rel: 'conformance',
          type: 'application/json',
          title: 'Conformance declaration',
        },
        {
          href: '/collections',
          rel: 'data',
          type: 'application/json',
          title: 'Collections',
        },
        {
          href: '/api',
          rel: 'service-desc',
          type: 'application/vnd.oai.openapi+json;version=3.0',
          title: 'API definition',
        },
      ],
    }
  })
}

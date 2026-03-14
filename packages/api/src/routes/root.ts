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

const linkSchema = {
  type: 'object',
  properties: {
    href: { type: 'string' },
    rel: { type: 'string' },
    type: { type: 'string' },
    title: { type: 'string' },
  },
} as const

export async function rootRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: LandingPage }>('/', {
    schema: {
      tags: ['OGC'],
      summary: 'Landing page',
      description: 'OGC API landing page with links to API resources',
      response: {
        200: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            links: { type: 'array', items: linkSchema },
          },
        },
      },
    },
    handler: async () => {
      return {
        title: 'Sanson',
        description: 'An open source geospatial server — OGC API Features compliant',
        links: [
          {
            href: '/',
            rel: 'self',
            type: 'application/json',
            title: 'This document',
          },
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
          {
            href: '/tileMatrixSets',
            rel: 'tiling-schemes',
            type: 'application/json',
            title: 'Tile matrix sets',
          },
        ],
      }
    },
  })
}

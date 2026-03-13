import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

interface CollectionsRouteOptions {
  db: Pool
}

interface OgcLink {
  href: string
  rel: string
  type: string
  title?: string
}

interface OgcCollection {
  id: string
  title: string
  description: string | null
  extent?: {
    spatial?: { bbox: number[][] }
    temporal?: { interval: (string | null)[][] }
  }
  itemType: 'feature'
  crs: string[]
  links: OgcLink[]
}

interface CollectionsResponse {
  links: OgcLink[]
  collections: OgcCollection[]
}

interface LayerRow {
  workspace_name: string
  name: string
  description: string | null
  bbox: number[] | null
  temporal_extent: (string | null)[] | null
}

const collectionsResponseSchema = {
  type: 'object',
  properties: {
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          href: { type: 'string' },
          rel: { type: 'string' },
          type: { type: 'string' },
          title: { type: 'string' },
        },
      },
    },
    collections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          extent: { type: 'object', additionalProperties: true },
          itemType: { type: 'string' },
          crs: { type: 'array', items: { type: 'string' } },
          links: { type: 'array' },
        },
      },
    },
  },
} as const

function buildCollection(row: LayerRow): OgcCollection {
  const collectionId = `${row.workspace_name}:${row.name}`

  const extent: OgcCollection['extent'] = {}
  if (row.bbox) {
    extent.spatial = { bbox: [row.bbox] }
  }
  if (row.temporal_extent) {
    extent.temporal = { interval: [row.temporal_extent] }
  }

  return {
    id: collectionId,
    title: row.name,
    description: row.description,
    ...(Object.keys(extent).length > 0 ? { extent } : {}),
    itemType: 'feature',
    crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'],
    links: [
      {
        href: `/collections/${collectionId}`,
        rel: 'self',
        type: 'application/json',
      },
      {
        href: `/collections/${collectionId}/items`,
        rel: 'items',
        type: 'application/geo+json',
      },
      {
        href: `/collections/${collectionId}/queryables`,
        rel: 'queryables',
        type: 'application/schema+json',
      },
    ],
  }
}

export async function collectionsRoutes(
  app: FastifyInstance,
  options: CollectionsRouteOptions,
): Promise<void> {
  app.get<{ Reply: CollectionsResponse }>('/collections', {
    schema: {
      tags: ['OGC'],
      summary: 'List collections',
      description: 'Lists all available feature collections',
      response: { 200: collectionsResponseSchema },
    },
    handler: async () => {
      const { rows } = await options.db.query<LayerRow>(
        `SELECT w.name AS workspace_name, l.name, l.description, l.bbox, l.temporal_extent
         FROM sanson_layers l
         JOIN sanson_workspaces w ON w.id = l.workspace_id
         ORDER BY w.name, l.name`,
      )

      return {
        links: [
          {
            href: '/collections',
            rel: 'self',
            type: 'application/json',
          },
        ],
        collections: rows.map(buildCollection),
      }
    },
  })
}

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

const collectionResponseSchema = {
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
} as const

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

  app.get<{ Params: { collectionId: string }; Reply: OgcCollection }>(
    '/collections/:collectionId',
    {
      schema: {
        tags: ['OGC'],
        summary: 'Collection metadata',
        description: 'Returns metadata for a single feature collection',
        params: {
          type: 'object',
          properties: {
            collectionId: {
              type: 'string',
              description: 'Collection identifier (workspaceId:layerName)',
            },
          },
          required: ['collectionId'],
        },
        response: {
          200: collectionResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const { collectionId } = request.params
        const separatorIndex = collectionId.indexOf(':')

        if (separatorIndex === -1) {
          reply.status(404)
          return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
        }

        const workspaceName = collectionId.slice(0, separatorIndex)
        const layerName = collectionId.slice(separatorIndex + 1)

        const { rows } = await options.db.query<LayerRow>(
          `SELECT w.name AS workspace_name, l.name, l.description, l.bbox, l.temporal_extent
           FROM sanson_layers l
           JOIN sanson_workspaces w ON w.id = l.workspace_id
           WHERE w.name = $1 AND l.name = $2`,
          [workspaceName, layerName],
        )

        if (rows.length === 0) {
          reply.status(404)
          return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
        }

        return buildCollection(rows[0])
      },
    },
  )
}

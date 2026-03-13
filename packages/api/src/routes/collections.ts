import { FastifyInstance, FastifyReply } from 'fastify'
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

interface LayerConfig {
  workspace_name: string
  name: string
  table_name: string
  geometry_column: string
  id_column: string
  srid: number
}

interface FeatureRow {
  id: string | number
  geojson: string
  properties: Record<string, unknown>
}

// --- Schemas ---

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
      items: collectionResponseSchema,
    },
  },
} as const

const featureCollectionResponseSchema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    features: { type: 'array' },
    numberMatched: { type: 'integer' },
    numberReturned: { type: 'integer' },
    timeStamp: { type: 'string' },
    links: { type: 'array' },
  },
} as const

// --- Helpers ---

function parseCollectionId(
  collectionId: string,
): { workspaceName: string; layerName: string } | null {
  const idx = collectionId.indexOf(':')
  if (idx === -1) return null
  return { workspaceName: collectionId.slice(0, idx), layerName: collectionId.slice(idx + 1) }
}

function sendNotFound(reply: FastifyReply) {
  reply.status(404)
  return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
}

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
      { href: `/collections/${collectionId}`, rel: 'self', type: 'application/json' },
      { href: `/collections/${collectionId}/items`, rel: 'items', type: 'application/geo+json' },
      {
        href: `/collections/${collectionId}/queryables`,
        rel: 'queryables',
        type: 'application/schema+json',
      },
    ],
  }
}

async function resolveLayer(
  db: Pool,
  workspaceName: string,
  layerName: string,
): Promise<LayerConfig | null> {
  const { rows } = await db.query<LayerConfig>(
    `SELECT w.name AS workspace_name, l.name, l.table_name, l.geometry_column, l.id_column, l.srid
     FROM sanson_layers l
     JOIN sanson_workspaces w ON w.id = l.workspace_id
     WHERE w.name = $1 AND l.name = $2`,
    [workspaceName, layerName],
  )
  return rows[0] ?? null
}

function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) return null
  return parts as [number, number, number, number]
}

// --- Routes ---

export async function collectionsRoutes(
  app: FastifyInstance,
  options: CollectionsRouteOptions,
): Promise<void> {
  // GET /collections
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
        links: [{ href: '/collections', rel: 'self', type: 'application/json' }],
        collections: rows.map(buildCollection),
      }
    },
  })

  // GET /collections/:collectionId
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
        response: { 200: collectionResponseSchema },
      },
      handler: async (request, reply) => {
        const parsed = parseCollectionId(request.params.collectionId)
        if (!parsed) return sendNotFound(reply)

        const { rows } = await options.db.query<LayerRow>(
          `SELECT w.name AS workspace_name, l.name, l.description, l.bbox, l.temporal_extent
           FROM sanson_layers l
           JOIN sanson_workspaces w ON w.id = l.workspace_id
           WHERE w.name = $1 AND l.name = $2`,
          [parsed.workspaceName, parsed.layerName],
        )

        if (rows.length === 0) return sendNotFound(reply)
        return buildCollection(rows[0])
      },
    },
  )

  // GET /collections/:collectionId/items
  app.get<{
    Params: { collectionId: string }
    Querystring: { limit?: string; offset?: string; bbox?: string }
  }>('/collections/:collectionId/items', {
    schema: {
      tags: ['OGC'],
      summary: 'Features',
      description: 'Returns features from a collection with optional filtering and pagination',
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
      querystring: {
        type: 'object',
        properties: {
          limit: {
            type: 'string',
            description: 'Maximum number of features (default 25, max 100)',
          },
          offset: { type: 'string', description: 'Start index (default 0)' },
          bbox: { type: 'string', description: 'Bounding box filter: minLon,minLat,maxLon,maxLat' },
        },
      },
      response: { 200: featureCollectionResponseSchema },
    },
    handler: async (request, reply) => {
      const parsed = parseCollectionId(request.params.collectionId)
      if (!parsed) return sendNotFound(reply)

      const layer = await resolveLayer(options.db, parsed.workspaceName, parsed.layerName)
      if (!layer) return sendNotFound(reply)

      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '25', 10) || 25, 1), 100)
      const offset = Math.max(parseInt(request.query.offset ?? '0', 10) || 0, 0)

      const collectionId = `${layer.workspace_name}:${layer.name}`
      const geomExpr =
        layer.srid === 4326 ? layer.geometry_column : `ST_Transform(${layer.geometry_column}, 4326)`

      // Build WHERE clauses
      const conditions: string[] = []
      const params: unknown[] = []
      let paramIndex = 1

      if (request.query.bbox) {
        const bbox = parseBbox(request.query.bbox)
        if (bbox) {
          conditions.push(
            `${layer.geometry_column} && ST_Transform(ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 4326), ${layer.srid})`,
          )
          params.push(...bbox)
          paramIndex += 4
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // CTE + RIGHT JOIN for results + total count in one query
      const sql = `
        WITH all_data AS (
          SELECT ${layer.id_column} AS id,
                 ST_AsGeoJSON(${geomExpr})::json AS geojson,
                 to_jsonb(t.*) - '${layer.id_column}' - '${layer.geometry_column}' AS properties
          FROM ${layer.table_name} t
          ${whereClause}
        )
        SELECT id, geojson, properties, full_count
        FROM (
          TABLE all_data
          ORDER BY id
          LIMIT $${paramIndex}
          OFFSET $${paramIndex + 1}
        ) sub
        RIGHT JOIN (SELECT COUNT(*) FROM all_data) c(full_count) ON TRUE
      `
      params.push(limit, offset)

      const { rows } = await options.db.query<FeatureRow & { full_count: string }>(sql, params)

      const numberMatched = parseInt(rows[0]?.full_count ?? '0', 10)
      // When RIGHT JOIN returns a single row with nulls, there are no features
      const features = rows
        .filter((r) => r.id != null)
        .map((r) => ({
          type: 'Feature' as const,
          id: r.id,
          geometry: r.geojson,
          properties: r.properties,
        }))

      const basePath = `/collections/${collectionId}/items`
      const links: OgcLink[] = [
        {
          href: `${basePath}?offset=${offset}&limit=${limit}`,
          rel: 'self',
          type: 'application/geo+json',
        },
      ]

      if (offset + limit < numberMatched) {
        links.push({
          href: `${basePath}?offset=${offset + limit}&limit=${limit}`,
          rel: 'next',
          type: 'application/geo+json',
        })
      }

      if (offset > 0) {
        const prevOffset = Math.max(offset - limit, 0)
        links.push({
          href: `${basePath}?offset=${prevOffset}&limit=${limit}`,
          rel: 'prev',
          type: 'application/geo+json',
        })
      }

      // HTTP headers
      reply.header('X-Total-Count', numberMatched)

      const linkHeader = links.map((l) => `<${l.href}>; rel="${l.rel}"`).join(', ')
      reply.header('Link', linkHeader)

      return {
        type: 'FeatureCollection',
        features,
        numberMatched,
        numberReturned: features.length,
        timeStamp: new Date().toISOString(),
        links,
      }
    },
  })

  // GET /collections/:collectionId/items/:fid
  app.get<{
    Params: { collectionId: string; fid: string }
  }>('/collections/:collectionId/items/:fid', {
    schema: {
      tags: ['OGC'],
      summary: 'Feature by identifier',
      description: 'Returns a single feature from a collection',
      params: {
        type: 'object',
        properties: {
          collectionId: {
            type: 'string',
            description: 'Collection identifier (workspaceId:layerName)',
          },
          fid: { type: 'string', description: 'Feature identifier' },
        },
        required: ['collectionId', 'fid'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            id: {},
            geometry: { type: 'object', additionalProperties: true },
            properties: { type: 'object', additionalProperties: true },
            links: { type: 'array' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const parsed = parseCollectionId(request.params.collectionId)
      if (!parsed) return sendNotFound(reply)

      const layer = await resolveLayer(options.db, parsed.workspaceName, parsed.layerName)
      if (!layer) return sendNotFound(reply)

      const collectionId = `${layer.workspace_name}:${layer.name}`
      const geomExpr =
        layer.srid === 4326 ? layer.geometry_column : `ST_Transform(${layer.geometry_column}, 4326)`

      const { rows } = await options.db.query<FeatureRow>(
        `SELECT ${layer.id_column} AS id,
                ST_AsGeoJSON(${geomExpr})::json AS geojson,
                to_jsonb(t.*) - '${layer.id_column}' - '${layer.geometry_column}' AS properties
         FROM ${layer.table_name} t
         WHERE ${layer.id_column} = $1`,
        [request.params.fid],
      )

      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Feature not found' }
      }

      const row = rows[0]
      return {
        type: 'Feature',
        id: row.id,
        geometry: row.geojson,
        properties: row.properties,
        links: [
          {
            href: `/collections/${collectionId}/items/${row.id}`,
            rel: 'self',
            type: 'application/geo+json',
          },
          { href: `/collections/${collectionId}`, rel: 'collection', type: 'application/json' },
        ],
      }
    },
  })
}

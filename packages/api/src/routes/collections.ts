import { FastifyInstance, FastifyReply } from 'fastify'
import { Pool } from 'pg'
import {
  parseCql2Text,
  parseCql2Json,
  buildSupportedCrs,
  resolveOutputSrid,
  uriToSrid,
} from '@sanson/core'

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
  storageCrs?: string
  links: OgcLink[]
}

interface CollectionsResponse {
  links: OgcLink[]
  collections: OgcCollection[]
}

interface CollectionRow {
  workspace_name: string
  name: string
  description: string | null
  bbox: number[] | null
  temporal_extent: (string | null)[] | null
  srid: number
}

interface ExposedField {
  source: string
  alias?: string
}

interface CollectionConfig {
  workspace_name: string
  name: string
  table_name: string
  geometry_column: string
  id_column: string
  datetime_column: string | null
  exposed_fields: ExposedField[] | null
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
    storageCrs: { type: 'string' },
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
): { workspaceName: string; collectionName: string } | null {
  const idx = collectionId.indexOf(':')
  if (idx === -1) return null
  return { workspaceName: collectionId.slice(0, idx), collectionName: collectionId.slice(idx + 1) }
}

function sendNotFound(reply: FastifyReply) {
  reply.status(404)
  return { statusCode: 404, error: 'Not Found', message: 'Collection not found' }
}

function buildCollection(row: CollectionRow): OgcCollection {
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
    crs: buildSupportedCrs(row.srid),
    storageCrs: `http://www.opengis.net/def/crs/EPSG/0/${row.srid}`,
    links: [
      { href: `/collections/${collectionId}`, rel: 'self', type: 'application/json' },
      { href: `/collections/${collectionId}/items`, rel: 'items', type: 'application/geo+json' },
      {
        href: `/collections/${collectionId}/queryables`,
        rel: 'queryables',
        type: 'application/schema+json',
      },
      {
        href: `/collections/${collectionId}/tiles`,
        rel: 'tiles',
        type: 'application/json',
      },
    ],
  }
}

async function resolveCollection(
  db: Pool,
  workspaceName: string,
  collectionName: string,
): Promise<CollectionConfig | null> {
  const { rows } = await db.query<CollectionConfig>(
    `SELECT w.name AS workspace_name, c.name, c.table_name, c.geometry_column, c.id_column, c.datetime_column, c.exposed_fields, c.srid
     FROM sanson_collections c
     JOIN sanson_workspaces w ON w.id = c.workspace_id
     WHERE w.name = $1 AND c.name = $2`,
    [workspaceName, collectionName],
  )
  return rows[0] ?? null
}

function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) return null
  return parts as [number, number, number, number]
}

/**
 * Build a SQL expression for properties based on exposed_fields.
 * When exposed_fields is null, returns all columns via to_jsonb minus id/geom.
 * When set, builds a jsonb_build_object with only the specified columns (with optional aliases).
 */
function buildPropertiesExpr(col: CollectionConfig): string {
  if (!col.exposed_fields || col.exposed_fields.length === 0) {
    return `to_jsonb(t.*) - '${col.id_column}' - '${col.geometry_column}'`
  }
  const pairs = col.exposed_fields
    .map((f) => `'${f.alias ?? f.source}', t."${f.source}"`)
    .join(', ')
  return `jsonb_build_object(${pairs})`
}

/**
 * Get the list of column names exposed by a collection.
 * When exposed_fields is null, queries information_schema for all non-id/non-geom columns.
 * Returns [{source, alias}] entries.
 */
async function getExposedColumns(
  db: Pool,
  col: CollectionConfig,
): Promise<{ source: string; alias: string; dataType: string }[]> {
  if (col.exposed_fields && col.exposed_fields.length > 0) {
    // Get data types for the exposed columns
    const { rows: allCols } = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
      [col.table_name],
    )
    const typeMap = new Map(allCols.map((c) => [c.column_name, c.data_type]))
    return col.exposed_fields.map((f) => ({
      source: f.source,
      alias: f.alias ?? f.source,
      dataType: typeMap.get(f.source) ?? 'text',
    }))
  }
  const { rows } = await db.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = $1 AND column_name NOT IN ($2, $3)
     ORDER BY ordinal_position`,
    [col.table_name, col.id_column, col.geometry_column],
  )
  return rows.map((c) => ({ source: c.column_name, alias: c.column_name, dataType: c.data_type }))
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
      const { rows } = await options.db.query<CollectionRow>(
        `SELECT w.name AS workspace_name, c.name, c.description, c.bbox, c.temporal_extent, c.srid
         FROM sanson_collections c
         JOIN sanson_workspaces w ON w.id = c.workspace_id
         ORDER BY w.name, c.name`,
      )

      return {
        links: [{ href: '/collections', rel: 'self', type: 'application/json' }],
        collections: rows.map(buildCollection),
      }
    },
  })

  // GET /collections/:collectionId
  app.get<{ Params: { collectionId: string } }>('/collections/:collectionId', {
    schema: {
      tags: ['OGC'],
      summary: 'Collection metadata',
      description: 'Returns metadata for a single feature collection',
      params: {
        type: 'object',
        properties: {
          collectionId: {
            type: 'string',
            description: 'Collection identifier (workspaceName:collectionName)',
          },
        },
        required: ['collectionId'],
      },
      response: { 200: collectionResponseSchema },
    },
    handler: async (request, reply) => {
      const parsed = parseCollectionId(request.params.collectionId)
      if (!parsed) return sendNotFound(reply)

      const { rows } = await options.db.query<CollectionRow>(
        `SELECT w.name AS workspace_name, c.name, c.description, c.bbox, c.temporal_extent, c.srid
           FROM sanson_collections c
           JOIN sanson_workspaces w ON w.id = c.workspace_id
           WHERE w.name = $1 AND c.name = $2`,
        [parsed.workspaceName, parsed.collectionName],
      )

      if (rows.length === 0) return sendNotFound(reply)
      return buildCollection(rows[0])
    },
  })

  // GET /collections/:collectionId/items
  app.get<{
    Params: { collectionId: string }
    Querystring: {
      limit?: string
      offset?: string
      bbox?: string
      datetime?: string
      lat?: string
      lon?: string
      radius?: string
      filter?: string
      'filter-lang'?: string
      crs?: string
      'bbox-crs'?: string
    }
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
            description: 'Collection identifier (workspaceName:collectionName)',
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
          datetime: {
            type: 'string',
            description:
              'Temporal filter: instant (2024-01-01) or interval (2024-01-01/2024-12-31)',
          },
          lat: { type: 'string', description: 'Latitude for point/radius filter (-90 to 90)' },
          lon: { type: 'string', description: 'Longitude for point/radius filter (-180 to 180)' },
          radius: {
            type: 'string',
            description: 'Search radius in meters (requires lat and lon)',
          },
          filter: { type: 'string', description: 'CQL2 filter expression (text or JSON)' },
          'filter-lang': {
            type: 'string',
            description: 'Filter language: cql2-text (default) or cql2-json',
          },
          crs: {
            type: 'string',
            description: 'Output CRS URI (default: CRS84)',
          },
          'bbox-crs': {
            type: 'string',
            description: 'CRS URI of the bbox parameter values (default: CRS84)',
          },
        },
      },
      response: { 200: featureCollectionResponseSchema },
    },
    handler: async (request, reply) => {
      const parsed = parseCollectionId(request.params.collectionId)
      if (!parsed) return sendNotFound(reply)

      const col = await resolveCollection(options.db, parsed.workspaceName, parsed.collectionName)
      if (!col) return sendNotFound(reply)

      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '25', 10) || 25, 1), 100)
      const offset = Math.max(parseInt(request.query.offset ?? '0', 10) || 0, 0)

      const collectionId = `${col.workspace_name}:${col.name}`

      // Resolve output CRS
      const supportedCrs = buildSupportedCrs(col.srid)
      let outputCrs: { srid: number; crsUri: string }
      try {
        outputCrs = resolveOutputSrid(request.query.crs)
      } catch {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: `Unsupported CRS: ${request.query.crs}`,
        }
      }
      if (request.query.crs && !supportedCrs.includes(outputCrs.crsUri)) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: `CRS not supported for this collection: ${request.query.crs}. Supported: ${supportedCrs.join(', ')}`,
        }
      }

      const geomExpr =
        col.srid === outputCrs.srid
          ? col.geometry_column
          : `ST_Transform(${col.geometry_column}, ${outputCrs.srid})`

      // Build WHERE clauses
      const conditions: string[] = []
      const params: unknown[] = []
      let paramIndex = 1

      if (request.query.bbox) {
        const bbox = parseBbox(request.query.bbox)
        if (bbox) {
          // Resolve bbox CRS (default: 4326/CRS84)
          const bboxSrid = request.query['bbox-crs'] ? uriToSrid(request.query['bbox-crs']) : 4326
          if (bboxSrid === null) {
            reply.status(400)
            return {
              statusCode: 400,
              error: 'Bad Request',
              message: `Unsupported bbox-crs: ${request.query['bbox-crs']}`,
            }
          }
          conditions.push(
            `${col.geometry_column} && ST_Transform(ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, ${bboxSrid}), ${col.srid})`,
          )
          params.push(...bbox)
          paramIndex += 4
        }
      }

      // Lat/lon/radius filter (Sanson shortcut)
      if (request.query.lat != null && request.query.lon != null) {
        const lat = parseFloat(request.query.lat)
        const lon = parseFloat(request.query.lon)
        if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lon) || lon < -180 || lon > 180) {
          reply.status(400)
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: 'Invalid lat/lon: lat must be -90..90, lon must be -180..180',
          }
        }
        if (request.query.radius != null) {
          const radius = parseFloat(request.query.radius)
          if (isNaN(radius) || radius <= 0) {
            reply.status(400)
            return {
              statusCode: 400,
              error: 'Bad Request',
              message: 'Invalid radius: must be a positive number (meters)',
            }
          }
          conditions.push(
            `ST_Intersects(${col.geometry_column}, ST_Transform(ST_Buffer(ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography, $${paramIndex + 2})::geometry, ${col.srid}))`,
          )
          params.push(lon, lat, radius)
          paramIndex += 3
        } else {
          conditions.push(
            `ST_Intersects(${col.geometry_column}, ST_Transform(ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326), ${col.srid}))`,
          )
          params.push(lon, lat)
          paramIndex += 2
        }
      } else if (request.query.radius != null) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'radius requires both lat and lon parameters',
        }
      }

      // Datetime filter (OGC Core)
      if (request.query.datetime) {
        if (!col.datetime_column) {
          reply.status(400)
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: 'This collection does not have a configured datetime column',
          }
        }
        const dt = request.query.datetime
        const dtCol = col.datetime_column
        if (dt.includes('/')) {
          // Interval: start/end (either can be '..' for open-ended)
          const [start, end] = dt.split('/')
          if (start && start !== '..') {
            conditions.push(`${dtCol} >= $${paramIndex}`)
            params.push(start)
            paramIndex++
          }
          if (end && end !== '..') {
            conditions.push(`${dtCol} <= $${paramIndex}`)
            params.push(end)
            paramIndex++
          }
        } else {
          // Instant: match the day
          conditions.push(`${dtCol}::date = $${paramIndex}::date`)
          params.push(dt)
          paramIndex++
        }
      }

      // CQL2 filter (text or JSON)
      if (request.query.filter) {
        const filterLang = request.query['filter-lang'] ?? 'cql2-text'
        if (filterLang !== 'cql2-text' && filterLang !== 'cql2-json') {
          reply.status(400)
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: `Unsupported filter-lang: ${filterLang}`,
          }
        }

        // Get allowed columns for validation
        const { rows: colRows } = await options.db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = $1 AND column_name NOT IN ($2)`,
          [col.table_name, col.id_column],
        )
        const allowedColumns = new Set(colRows.map((r) => r.column_name))

        const cqlOptions = {
          startParamIndex: paramIndex,
          geometryColumn: col.geometry_column,
          srid: col.srid,
          allowedColumns,
        }

        try {
          let cqlResult
          if (filterLang === 'cql2-json') {
            const jsonExpr = JSON.parse(request.query.filter)
            cqlResult = parseCql2Json(jsonExpr, cqlOptions)
          } else {
            cqlResult = parseCql2Text(request.query.filter, cqlOptions)
          }
          if (cqlResult.sql) {
            conditions.push(cqlResult.sql)
            params.push(...cqlResult.params)
            paramIndex += cqlResult.params.length
          }
        } catch (err) {
          reply.status(400)
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: `Invalid CQL2 filter: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // CTE + RIGHT JOIN for results + total count in one query
      const propsExpr = buildPropertiesExpr(col)
      const sql = `
        WITH all_data AS (
          SELECT ${col.id_column} AS id,
                 ST_AsGeoJSON(${geomExpr})::json AS geojson,
                 ${propsExpr} AS properties
          FROM ${col.table_name} t
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

      // Build pagination links preserving query params
      const basePath = `/collections/${collectionId}/items`
      const extraParams = new URLSearchParams()
      if (request.query.bbox) extraParams.set('bbox', request.query.bbox)
      if (request.query.datetime) extraParams.set('datetime', request.query.datetime)
      if (request.query.lat) extraParams.set('lat', request.query.lat)
      if (request.query.lon) extraParams.set('lon', request.query.lon)
      if (request.query.radius) extraParams.set('radius', request.query.radius)
      if (request.query.filter) extraParams.set('filter', request.query.filter)
      if (request.query['filter-lang']) extraParams.set('filter-lang', request.query['filter-lang'])
      if (request.query.crs) extraParams.set('crs', request.query.crs)
      if (request.query['bbox-crs']) extraParams.set('bbox-crs', request.query['bbox-crs'])

      function buildLink(rel: string, linkOffset: number): OgcLink {
        const p = new URLSearchParams(extraParams)
        p.set('offset', String(linkOffset))
        p.set('limit', String(limit))
        return { href: `${basePath}?${p}`, rel, type: 'application/geo+json' }
      }

      const links: OgcLink[] = [buildLink('self', offset)]

      if (offset + limit < numberMatched) {
        links.push(buildLink('next', offset + limit))
      }

      if (offset > 0) {
        links.push(buildLink('prev', Math.max(offset - limit, 0)))
      }

      // first and last
      links.push(buildLink('first', 0))
      if (numberMatched > 0) {
        const lastOffset = Math.max(Math.floor((numberMatched - 1) / limit) * limit, 0)
        links.push(buildLink('last', lastOffset))
      }

      // HTTP headers
      reply.header('X-Total-Count', numberMatched)
      reply.header('Content-Crs', `<${outputCrs.crsUri}>`)

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
    Querystring: { crs?: string }
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
            description: 'Collection identifier (workspaceName:collectionName)',
          },
          fid: { type: 'string', description: 'Feature identifier' },
        },
        required: ['collectionId', 'fid'],
      },
      querystring: {
        type: 'object',
        properties: {
          crs: { type: 'string', description: 'Output CRS URI (default: CRS84)' },
        },
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

      const col = await resolveCollection(options.db, parsed.workspaceName, parsed.collectionName)
      if (!col) return sendNotFound(reply)

      const collectionId = `${col.workspace_name}:${col.name}`

      // Resolve output CRS
      let fidOutputCrs: { srid: number; crsUri: string }
      try {
        fidOutputCrs = resolveOutputSrid(request.query.crs)
      } catch {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: `Unsupported CRS: ${request.query.crs}`,
        }
      }

      const geomExpr =
        col.srid === fidOutputCrs.srid
          ? col.geometry_column
          : `ST_Transform(${col.geometry_column}, ${fidOutputCrs.srid})`

      const propsExpr = buildPropertiesExpr(col)
      const { rows } = await options.db.query<FeatureRow>(
        `SELECT ${col.id_column} AS id,
                ST_AsGeoJSON(${geomExpr})::json AS geojson,
                ${propsExpr} AS properties
         FROM ${col.table_name} t
         WHERE ${col.id_column} = $1`,
        [request.params.fid],
      )

      if (rows.length === 0) {
        reply.status(404)
        return { statusCode: 404, error: 'Not Found', message: 'Feature not found' }
      }

      reply.header('Content-Crs', `<${fidOutputCrs.crsUri}>`)

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

  // GET /collections/:collectionId/queryables
  app.get<{ Params: { collectionId: string } }>('/collections/:collectionId/queryables', {
    schema: {
      tags: ['OGC'],
      summary: 'Queryable properties',
      description: 'Returns a JSON Schema describing the queryable properties of a collection',
      params: {
        type: 'object',
        properties: {
          collectionId: {
            type: 'string',
            description: 'Collection identifier (workspaceName:collectionName)',
          },
        },
        required: ['collectionId'],
      },
    },
    handler: async (request, reply) => {
      const parsed = parseCollectionId(request.params.collectionId)
      if (!parsed) return sendNotFound(reply)

      const col = await resolveCollection(options.db, parsed.workspaceName, parsed.collectionName)
      if (!col) return sendNotFound(reply)

      const collectionId = `${col.workspace_name}:${col.name}`

      const exposedCols = await getExposedColumns(options.db, col)

      const pgToJsonType: Record<string, { type: string }> = {
        integer: { type: 'integer' },
        bigint: { type: 'integer' },
        smallint: { type: 'integer' },
        'double precision': { type: 'number' },
        real: { type: 'number' },
        numeric: { type: 'number' },
        boolean: { type: 'boolean' },
        text: { type: 'string' },
        'character varying': { type: 'string' },
        character: { type: 'string' },
        date: { type: 'string' },
        'timestamp without time zone': { type: 'string' },
        'timestamp with time zone': { type: 'string' },
      }

      const properties: Record<string, { type: string; title: string }> = {}
      for (const col of exposedCols) {
        properties[col.alias] = {
          title: col.alias,
          ...(pgToJsonType[col.dataType] ?? { type: 'string' }),
        }
      }

      reply.header('Content-Type', 'application/schema+json')
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `/collections/${collectionId}/queryables`,
        type: 'object',
        title: collectionId,
        properties: {
          geometry: {
            $ref: 'https://geojson.org/schema/Geometry.json',
          },
          ...properties,
        },
      }
    },
  })

  // GET /collections/:collectionId/tiles
  app.get<{ Params: { collectionId: string } }>('/collections/:collectionId/tiles', {
    schema: {
      tags: ['OGC'],
      summary: 'Tileset metadata',
      description: 'Returns tileset metadata for a collection',
      params: {
        type: 'object',
        properties: {
          collectionId: {
            type: 'string',
            description: 'Collection identifier (workspaceName:collectionName)',
          },
        },
        required: ['collectionId'],
      },
    },
    handler: async (request, reply) => {
      const parsed = parseCollectionId(request.params.collectionId)
      if (!parsed) return sendNotFound(reply)

      const { rows } = await options.db.query<{
        workspace_name: string
        name: string
        description: string | null
        bbox: number[] | null
        geometry_type: string | null
      }>(
        `SELECT w.name AS workspace_name, c.name, c.description, c.bbox, c.geometry_type
         FROM sanson_collections c
         JOIN sanson_workspaces w ON w.id = c.workspace_id
         WHERE w.name = $1 AND c.name = $2`,
        [parsed.workspaceName, parsed.collectionName],
      )

      if (rows.length === 0) return sendNotFound(reply)

      const col = rows[0]
      const collectionId = `${col.workspace_name}:${col.name}`

      return {
        title: col.name,
        description: col.description,
        dataType: 'vector',
        crs: 'http://www.opengis.net/def/crs/EPSG/0/3857',
        tileMatrixSetId: 'WebMercatorQuad',
        links: [
          {
            href: `/collections/${collectionId}/tiles`,
            rel: 'self',
            type: 'application/json',
          },
          {
            href: `/collections/${collectionId}/tiles/WebMercatorQuad/{z}/{x}/{y}.pbf`,
            rel: 'item',
            type: 'application/vnd.mapbox-vector-tile',
            templated: true,
          },
          {
            href: `/collections/${collectionId}/tiles/{z}/{x}/{y}.pbf`,
            rel: 'item',
            type: 'application/vnd.mapbox-vector-tile',
            templated: true,
            title: 'Shorthand tile URL',
          },
          {
            href: '/tileMatrixSets/WebMercatorQuad',
            rel: 'tiling-scheme',
            type: 'application/json',
          },
          {
            href: `/collections/${collectionId}`,
            rel: 'collection',
            type: 'application/json',
          },
        ],
        ...(col.bbox
          ? {
              boundingBox: {
                lowerLeft: [col.bbox[0], col.bbox[1]],
                upperRight: [col.bbox[2], col.bbox[3]],
                crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
              },
            }
          : {}),
      }
    },
  })

  // GET /collections/:collectionId/style
  app.get<{ Params: { collectionId: string } }>('/collections/:collectionId/style', {
    schema: {
      tags: ['OGC'],
      summary: 'Collection style',
      description: 'Returns the style configuration for a collection',
      params: {
        type: 'object',
        properties: {
          collectionId: {
            type: 'string',
            description: 'Collection identifier (workspaceName:collectionName)',
          },
        },
        required: ['collectionId'],
      },
    },
    handler: async (request, reply) => {
      const parsed = parseCollectionId(request.params.collectionId)
      if (!parsed) return sendNotFound(reply)

      const { rows } = await options.db.query<{ style: object | null }>(
        `SELECT c.style
         FROM sanson_collections c
         JOIN sanson_workspaces w ON w.id = c.workspace_id
         WHERE w.name = $1 AND c.name = $2`,
        [parsed.workspaceName, parsed.collectionName],
      )

      if (rows.length === 0) return sendNotFound(reply)
      if (!rows[0].style) {
        reply.status(204)
        return
      }
      return rows[0].style
    },
  })

  // GET /collections/:collectionId/tiles/:z/:x/:y.pbf
  app.get<{
    Params: { collectionId: string; z: string; x: string; y: string }
  }>('/collections/:collectionId/tiles/:z/:x/:y.pbf', {
    schema: {
      tags: ['OGC'],
      summary: 'Vector tile (MVT)',
      description: 'Returns a Mapbox Vector Tile for the given tile coordinates',
      params: {
        type: 'object',
        properties: {
          collectionId: {
            type: 'string',
            description: 'Collection identifier (workspaceName:collectionName)',
          },
          z: { type: 'string', description: 'Zoom level' },
          x: { type: 'string', description: 'Tile column' },
          y: { type: 'string', description: 'Tile row' },
        },
        required: ['collectionId', 'z', 'x', 'y'],
      },
    },
    handler: async (request, reply) => {
      const parsed = parseCollectionId(request.params.collectionId)
      if (!parsed) return sendNotFound(reply)

      const col = await resolveCollection(options.db, parsed.workspaceName, parsed.collectionName)
      if (!col) return sendNotFound(reply)

      const z = parseInt(request.params.z, 10)
      const x = parseInt(request.params.x, 10)
      const y = parseInt(request.params.y, 10)

      if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || z > 30) {
        reply.status(400)
        return { statusCode: 400, error: 'Bad Request', message: 'Invalid tile coordinates' }
      }

      // Get columns for tile properties (respects exposed_fields)
      const exposedCols = await getExposedColumns(options.db, col)

      const propColumns = exposedCols
        .map((c) =>
          c.alias !== c.source ? `"${c.source}"::text AS "${c.alias}"` : `"${c.source}"::text`,
        )
        .join(', ')
      const propSelect = propColumns ? `, ${propColumns}` : ''

      const sql = `
        WITH mvtgeom AS (
          SELECT ST_AsMVTGeom(
            ST_Transform(${col.geometry_column}, 3857),
            ST_TileEnvelope($1, $2, $3),
            extent => 4096,
            buffer => 256
          ) AS geom
          ${propSelect}
          FROM ${col.table_name}
          WHERE ${col.geometry_column} && ST_Transform(
            ST_TileEnvelope($1, $2, $3, margin => (256.0 / 4096)),
            ${col.srid}
          )
        )
        SELECT ST_AsMVT(mvtgeom.*, $4) AS mvt FROM mvtgeom
      `

      const { rows } = await options.db.query<{ mvt: Buffer }>(sql, [z, x, y, col.name])

      const mvt = rows[0]?.mvt

      reply.header('Content-Type', 'application/vnd.mapbox-vector-tile')
      reply.header('Cache-Control', 'public, max-age=3600')

      if (!mvt || mvt.length === 0) {
        // Empty tile — return 204
        reply.status(204)
        return
      }

      return mvt
    },
  })
}

import { FastifyInstance } from 'fastify'

// WebMercatorQuad tile matrix set (OGC standard)
// Reference: https://docs.ogc.org/is/17-083r4/17-083r4.html

const WEB_MERCATOR_QUAD_ID = 'WebMercatorQuad'
const WEB_MERCATOR_CRS = 'http://www.opengis.net/def/crs/EPSG/0/3857'
const ORIGIN = [-20037508.3427892, 20037508.3427892]
const TILE_SIZE = 256
const MAX_ZOOM = 24

// Scale denominator at zoom 0 for WebMercatorQuad (OGC standard value)
const SCALE_DENOM_Z0 = 559082264.0287178

function buildTileMatrices() {
  const matrices = []
  for (let z = 0; z <= MAX_ZOOM; z++) {
    const matrixSize = Math.pow(2, z)
    matrices.push({
      id: String(z),
      scaleDenominator: SCALE_DENOM_Z0 / matrixSize,
      cellSize: (20037508.3427892 * 2) / (TILE_SIZE * matrixSize),
      topLeftCorner: ORIGIN,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      matrixWidth: matrixSize,
      matrixHeight: matrixSize,
    })
  }
  return matrices
}

const webMercatorQuad = {
  id: WEB_MERCATOR_QUAD_ID,
  title: 'Google Maps Compatible for the World',
  uri: 'http://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad',
  crs: WEB_MERCATOR_CRS,
  wellKnownScaleSet: 'http://www.opengis.net/def/wkss/OGC/1.0/GoogleMapsCompatible',
  tileMatrices: buildTileMatrices(),
}

export async function tileMatrixSetsRoutes(app: FastifyInstance): Promise<void> {
  // GET /tileMatrixSets
  app.get('/tileMatrixSets', {
    schema: {
      tags: ['OGC'],
      summary: 'List tile matrix sets',
      description: 'Returns the list of available tile matrix sets',
    },
    handler: async () => {
      return {
        tileMatrixSets: [
          {
            id: webMercatorQuad.id,
            title: webMercatorQuad.title,
            uri: webMercatorQuad.uri,
            crs: webMercatorQuad.crs,
            links: [
              {
                href: `/tileMatrixSets/${WEB_MERCATOR_QUAD_ID}`,
                rel: 'self',
                type: 'application/json',
              },
            ],
          },
        ],
      }
    },
  })

  // GET /tileMatrixSets/:tileMatrixSetId
  app.get<{ Params: { tileMatrixSetId: string } }>('/tileMatrixSets/:tileMatrixSetId', {
    schema: {
      tags: ['OGC'],
      summary: 'Tile matrix set definition',
      description: 'Returns the full definition of a tile matrix set',
      params: {
        type: 'object',
        properties: {
          tileMatrixSetId: { type: 'string' },
        },
        required: ['tileMatrixSetId'],
      },
    },
    handler: async (request, reply) => {
      if (request.params.tileMatrixSetId !== WEB_MERCATOR_QUAD_ID) {
        reply.status(404)
        return {
          statusCode: 404,
          error: 'Not Found',
          message: `Tile matrix set '${request.params.tileMatrixSetId}' not found`,
        }
      }
      return webMercatorQuad
    },
  })
}

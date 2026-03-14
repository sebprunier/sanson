/**
 * CRS utility module — OGC CRS URI parsing and SRID mapping.
 */

export const CRS84_URI = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
const EPSG_URI_PREFIX = 'http://www.opengis.net/def/crs/EPSG/0/'
const BASE_SUPPORTED_SRIDS = [4326, 3857, 2154]

export function sridToUri(srid: number): string {
  return `${EPSG_URI_PREFIX}${srid}`
}

export function uriToSrid(uri: string): number | null {
  if (uri === CRS84_URI) return 4326
  if (uri.startsWith(EPSG_URI_PREFIX)) {
    const code = parseInt(uri.slice(EPSG_URI_PREFIX.length), 10)
    return isNaN(code) ? null : code
  }
  return null
}

export function buildSupportedCrs(nativeSrid: number): string[] {
  const uris = [CRS84_URI]
  const seen = new Set<number>()
  for (const srid of BASE_SUPPORTED_SRIDS) {
    uris.push(sridToUri(srid))
    seen.add(srid)
  }
  if (!seen.has(nativeSrid)) {
    uris.push(sridToUri(nativeSrid))
  }
  return uris
}

export function resolveOutputSrid(crsUri: string | undefined): { srid: number; crsUri: string } {
  if (!crsUri || crsUri === CRS84_URI) {
    return { srid: 4326, crsUri: CRS84_URI }
  }
  const srid = uriToSrid(crsUri)
  if (srid === null) {
    throw new Error(`Unsupported CRS: ${crsUri}`)
  }
  return { srid, crsUri }
}

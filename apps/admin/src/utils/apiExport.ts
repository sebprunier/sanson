import type { Collection } from '../services/api'

interface Endpoint {
  name: string
  method: string
  url: string
  description: string
  folder: string
}

function buildEndpoints(base: string, collectionId: string, collection: Collection): Endpoint[] {
  const col = encodeURIComponent(collectionId)
  const bbox: number[] | null = collection.bbox
    ? typeof collection.bbox === 'string'
      ? JSON.parse(collection.bbox)
      : collection.bbox
    : null
  const bboxStr = bbox ? bbox.join(',') : '-1.5,43.2,1.3,45.8'
  const lonCenter = bbox ? ((bbox[0] + bbox[2]) / 2).toFixed(4) : '2.3488'
  const latCenter = bbox ? ((bbox[1] + bbox[3]) / 2).toFixed(4) : '48.8534'

  const endpoints: Endpoint[] = [
    {
      name: 'Collection metadata',
      method: 'GET',
      url: `${base}/collections/${col}`,
      description: 'Collection description and metadata',
      folder: 'Metadata',
    },
    {
      name: 'Queryables',
      method: 'GET',
      url: `${base}/collections/${col}/queryables`,
      description: 'Available properties for filtering',
      folder: 'Metadata',
    },
    {
      name: 'Items',
      method: 'GET',
      url: `${base}/collections/${col}/items`,
      description: 'First page of features (GeoJSON)',
      folder: 'Features',
    },
    {
      name: 'Items with pagination',
      method: 'GET',
      url: `${base}/collections/${col}/items?limit=10&offset=0`,
      description: 'Paginated features',
      folder: 'Features',
    },
    {
      name: 'Items with bbox',
      method: 'GET',
      url: `${base}/collections/${col}/items?bbox=${bboxStr}`,
      description: 'Spatial filter with bounding box',
      folder: 'Features',
    },
    {
      name: 'Single feature',
      method: 'GET',
      url: `${base}/collections/${col}/items/1`,
      description: 'Get a feature by ID',
      folder: 'Features',
    },
    {
      name: 'CQL2 Text filter',
      method: 'GET',
      url: `${base}/collections/${col}/items?filter-lang=cql2-text&filter=property%3D'value'`,
      description: 'Filter features with CQL2 text expression',
      folder: 'Filtering',
    },
    {
      name: 'Point intersection',
      method: 'GET',
      url: `${base}/collections/${col}/items?lon=${lonCenter}&lat=${latCenter}`,
      description: 'Features intersecting a point',
      folder: 'Filtering',
    },
    {
      name: 'Radius search',
      method: 'GET',
      url: `${base}/collections/${col}/items?lon=${lonCenter}&lat=${latCenter}&radius=5000`,
      description: 'Features within a radius (meters)',
      folder: 'Filtering',
    },
    {
      name: 'Reproject to EPSG 3857',
      method: 'GET',
      url: `${base}/collections/${col}/items?limit=5&crs=http%3A%2F%2Fwww.opengis.net%2Fdef%2Fcrs%2FEPSG%2F0%2F3857`,
      description: 'Get features in Web Mercator',
      folder: 'CRS',
    },
    {
      name: 'Vector tile (z6)',
      method: 'GET',
      url: `${base}/collections/${col}/tiles/6/32/22.pbf`,
      description: 'Mapbox Vector Tile (MVT)',
      folder: 'Tiles',
    },
  ]

  if (collection.datetime_column) {
    endpoints.push(
      {
        name: 'Datetime instant',
        method: 'GET',
        url: `${base}/collections/${col}/items?datetime=2024-01-01T00:00:00Z`,
        description: 'Features at a specific time',
        folder: 'Temporal',
      },
      {
        name: 'Datetime interval',
        method: 'GET',
        url: `${base}/collections/${col}/items?datetime=2024-01-01T00:00:00Z/2024-12-31T23:59:59Z`,
        description: 'Features within a time range',
        folder: 'Temporal',
      },
    )
  }

  return endpoints
}

// --- Bruno export ---

function toBruFile(endpoint: Endpoint): string {
  const parsed = new URL(endpoint.url)
  const params = Array.from(parsed.searchParams.entries())
  const urlWithoutQuery = `${parsed.origin}${parsed.pathname}`

  let content = `meta {
  name: ${endpoint.name}
  type: http
  seq: 1
}

${endpoint.method.toLowerCase()} {
  url: ${urlWithoutQuery}${params.length > 0 ? '?' + params.map(([k]) => `{{${k}}}`).join('&') : ''}
  body: none
  auth: none
}
`

  if (params.length > 0) {
    content += `\nquery {\n`
    for (const [key, value] of params) {
      content += `  ${key}: ${value}\n`
    }
    content += `}\n`
  }

  return content
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
}

export async function exportBruno(collectionId: string, collection: Collection): Promise<void> {
  const base = window.location.origin
  const endpoints = buildEndpoints(base, collectionId, collection)
  const collName = sanitizeFilename(collectionId)

  // Build ZIP using JSZip-like manual approach (no dependency needed)
  // We'll use the simpler approach: download a single .bru collection file
  // Actually, Bruno uses a folder structure. Let's generate individual files and zip them.

  // Use the built-in CompressionStream API to create a zip
  // For simplicity, we'll use a basic zip implementation
  const files: Array<{ path: string; content: string }> = []

  // Bruno collection config
  files.push({
    path: `${collName}/bruno.json`,
    content: JSON.stringify(
      {
        version: '1',
        name: `Sanson — ${collectionId}`,
        type: 'collection',
      },
      null,
      2,
    ),
  })

  // Group by folder
  const folders = new Set(endpoints.map((e) => e.folder))
  for (const folder of folders) {
    const folderEndpoints = endpoints.filter((e) => e.folder === folder)
    for (const ep of folderEndpoints) {
      files.push({
        path: `${collName}/${sanitizeFilename(folder)}/${sanitizeFilename(ep.name)}.bru`,
        content: toBruFile(ep),
      })
    }
  }

  await downloadZip(files, `sanson-${collName}-bruno.zip`)
}

// --- Postman export ---

export function exportPostman(collectionId: string, collection: Collection): void {
  const base = window.location.origin
  const endpoints = buildEndpoints(base, collectionId, collection)

  // Group endpoints by folder
  const folders = new Map<string, Endpoint[]>()
  for (const ep of endpoints) {
    const list = folders.get(ep.folder) ?? []
    list.push(ep)
    folders.set(ep.folder, list)
  }

  const postmanCollection = {
    info: {
      name: `Sanson — ${collectionId}`,
      description: `OGC API — Features endpoints for collection ${collectionId}`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: Array.from(folders.entries()).map(([folder, eps]) => ({
      name: folder,
      item: eps.map((ep) => {
        const parsed = new URL(ep.url)
        const query = Array.from(parsed.searchParams.entries()).map(([key, value]) => ({
          key,
          value,
        }))
        return {
          name: ep.name,
          request: {
            method: ep.method,
            header: [],
            url: {
              raw: ep.url,
              protocol: parsed.protocol.replace(':', ''),
              host: parsed.hostname.split('.'),
              port: parsed.port || undefined,
              path: parsed.pathname.split('/').filter(Boolean),
              query: query.length > 0 ? query : undefined,
            },
            description: ep.description,
          },
        }
      }),
    })),
  }

  const blob = new Blob([JSON.stringify(postmanCollection, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `sanson-${sanitizeFilename(collectionId)}-postman.json`)
}

// --- Helpers ---

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Minimal ZIP builder (no external dependency)
// Supports only stored (uncompressed) files — sufficient for small text files
async function downloadZip(
  files: Array<{ path: string; content: string }>,
  filename: string,
): Promise<void> {
  const encoder = new TextEncoder()
  const entries: Array<{ path: Uint8Array; data: Uint8Array; offset: number }> = []
  const parts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const pathBytes = encoder.encode(file.path)
    const dataBytes = encoder.encode(file.content)
    const crc = crc32(dataBytes)

    // Local file header (30 bytes + path + data)
    const header = new ArrayBuffer(30)
    const hv = new DataView(header)
    hv.setUint32(0, 0x04034b50, true) // signature
    hv.setUint16(4, 20, true) // version needed
    hv.setUint16(6, 0, true) // flags
    hv.setUint16(8, 0, true) // compression (stored)
    hv.setUint16(10, 0, true) // mod time
    hv.setUint16(12, 0, true) // mod date
    hv.setUint32(14, crc, true) // crc32
    hv.setUint32(18, dataBytes.length, true) // compressed size
    hv.setUint32(22, dataBytes.length, true) // uncompressed size
    hv.setUint16(26, pathBytes.length, true) // filename length
    hv.setUint16(28, 0, true) // extra length

    const headerBytes = new Uint8Array(header)
    parts.push(headerBytes, pathBytes, dataBytes)
    entries.push({ path: pathBytes, data: dataBytes, offset })
    offset += headerBytes.length + pathBytes.length + dataBytes.length
  }

  // Central directory
  const centralStart = offset
  for (const entry of entries) {
    const crc = crc32(entry.data)
    const cd = new ArrayBuffer(46)
    const cv = new DataView(cd)
    cv.setUint32(0, 0x02014b50, true) // signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0, true) // flags
    cv.setUint16(10, 0, true) // compression
    cv.setUint16(12, 0, true) // mod time
    cv.setUint16(14, 0, true) // mod date
    cv.setUint32(16, crc, true) // crc32
    cv.setUint32(20, entry.data.length, true) // compressed
    cv.setUint32(24, entry.data.length, true) // uncompressed
    cv.setUint16(28, entry.path.length, true) // name length
    cv.setUint16(30, 0, true) // extra length
    cv.setUint16(32, 0, true) // comment length
    cv.setUint16(34, 0, true) // disk start
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, entry.offset, true) // local header offset

    const cdBytes = new Uint8Array(cd)
    parts.push(cdBytes, entry.path)
    offset += cdBytes.length + entry.path.length
  }

  // End of central directory
  const eocd = new ArrayBuffer(22)
  const ev = new DataView(eocd)
  ev.setUint32(0, 0x06054b50, true) // signature
  ev.setUint16(4, 0, true) // disk number
  ev.setUint16(6, 0, true) // central dir disk
  ev.setUint16(8, entries.length, true) // entries on disk
  ev.setUint16(10, entries.length, true) // total entries
  ev.setUint32(12, offset - centralStart, true) // central dir size
  ev.setUint32(16, centralStart, true) // central dir offset
  ev.setUint16(20, 0, true) // comment length

  parts.push(new Uint8Array(eocd))

  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(total)
  let pos = 0
  for (const part of parts) {
    result.set(part, pos)
    pos += part.length
  }
  const blob = new Blob([result.buffer], { type: 'application/zip' })
  downloadBlob(blob, filename)
}

// CRC32 lookup table
const crcTable: number[] = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[n] = c
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

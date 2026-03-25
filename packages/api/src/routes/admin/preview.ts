import { FastifyInstance } from 'fastify'
import { mkdirSync, createWriteStream, unlinkSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { gunzipSync } from 'zlib'
import {
  spawnProcess,
  stripBom,
  detectSeparator,
  parseCsvLine,
  autoDetectGeoColumns,
  inferSqlType,
  sanitizeColumnName,
} from '@sanson/core'
import type { GeoJsonFeature, GeoJsonFeatureCollection } from '@sanson/core'

interface PreviewResult {
  format: 'geojson' | 'csv' | 'shapefile'
  feature_count: number | null
  geometry_type: string | null
  srid: number | null
  fields: Array<{ name: string; type: string }>
  csv_info?: {
    separator: string
    longitude_column: string | null
    latitude_column: string | null
  }
  sample_rows: Array<Record<string, unknown>>
  sample_geojson: {
    type: 'FeatureCollection'
    features: Array<object>
  } | null
  bbox: [number, number, number, number] | null
}

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads'
const CSV_EXTENSIONS = ['.csv']
const SHAPEFILE_EXTENSIONS = ['.zip']

function computeBbox(
  features: GeoJsonFeature[],
  maxFeatures = 1000,
): [number, number, number, number] | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let count = 0

  function visit(coords: unknown): void {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      minX = Math.min(minX, coords[0])
      minY = Math.min(minY, coords[1])
      maxX = Math.max(maxX, coords[0])
      maxY = Math.max(maxY, coords[1])
    } else {
      for (const c of coords) visit(c)
    }
  }

  for (const f of features) {
    if (count >= maxFeatures) break
    if (f.geometry?.coordinates) visit(f.geometry.coordinates)
    count++
  }

  if (!isFinite(minX)) return null
  return [minX, minY, maxX, maxY]
}

function inferJsType(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'DOUBLE PRECISION'
  }
  if (typeof value === 'boolean') return 'BOOLEAN'
  return 'TEXT'
}

function previewGeoJson(buffer: Buffer, fileName: string): PreviewResult {
  // Decompress gzip if needed
  let data = buffer
  const isGzip = fileName.endsWith('.gz') || (buffer[0] === 0x1f && buffer[1] === 0x8b)
  if (isGzip) {
    data = gunzipSync(buffer)
  }

  const geojson: GeoJsonFeatureCollection = JSON.parse(data.toString('utf-8'))
  if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new Error('File must be a GeoJSON FeatureCollection')
  }

  const features = geojson.features
  const firstFeature = features[0]

  // Geometry type from first feature
  const geometryType = firstFeature?.geometry?.type ?? null

  // Fields from first feature properties
  const fields: Array<{ name: string; type: string }> = []
  if (firstFeature?.properties) {
    for (const [key, value] of Object.entries(firstFeature.properties)) {
      fields.push({ name: key, type: inferJsType(value) })
    }
  }

  // Sample rows — first 5 features' properties
  const sampleRows = features.slice(0, 5).map((f) => f.properties ?? {})

  // Sample GeoJSON — first 100 features
  const sampleFeatures = features.slice(0, 100)

  // Bbox — computed from up to 1000 features
  const bbox = computeBbox(features)

  return {
    format: 'geojson',
    feature_count: features.length,
    geometry_type: geometryType,
    srid: null,
    fields,
    sample_rows: sampleRows,
    sample_geojson: { type: 'FeatureCollection', features: sampleFeatures },
    bbox,
  }
}

function previewCsv(buffer: Buffer): PreviewResult {
  const text = stripBom(buffer.toString('utf-8'))
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')

  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row')
  }

  const separator = detectSeparator(lines[0])
  const rawHeaders = parseCsvLine(lines[0], separator)
  const headers = rawHeaders.map((h) => h.trim())
  const sanitizedHeaders = headers.map(sanitizeColumnName)

  // Parse data lines (up to 100 for type inference)
  const dataLines = lines.slice(1)
  const sampleCount = Math.min(dataLines.length, 100)
  const parsedRows: string[][] = []
  for (let i = 0; i < sampleCount; i++) {
    parsedRows.push(parseCsvLine(dataLines[i], separator))
  }

  // Infer types from sample
  const fields: Array<{ name: string; type: string }> = sanitizedHeaders.map((name, colIdx) => {
    const values = parsedRows.map((row) => row[colIdx] ?? '')
    return { name, type: inferSqlType(values) }
  })

  // Detect geo columns
  const geoDetect = autoDetectGeoColumns(headers)
  const lonIdx = geoDetect ? headers.indexOf(geoDetect.longitudeColumn) : -1
  const latIdx = geoDetect ? headers.indexOf(geoDetect.latitudeColumn) : -1

  // Sample rows — first 5 as objects
  const sampleRows: Array<Record<string, unknown>> = []
  for (let i = 0; i < Math.min(5, parsedRows.length); i++) {
    const row: Record<string, unknown> = {}
    for (let j = 0; j < sanitizedHeaders.length; j++) {
      const val = parsedRows[i][j] ?? ''
      const fieldType = fields[j]?.type
      if (fieldType === 'INTEGER' && val !== '') row[sanitizedHeaders[j]] = parseInt(val, 10)
      else if (fieldType === 'DOUBLE PRECISION' && val !== '')
        row[sanitizedHeaders[j]] = parseFloat(val)
      else row[sanitizedHeaders[j]] = val
    }
    sampleRows.push(row)
  }

  // Sample GeoJSON — build Points from lon/lat (up to 100 rows)
  let sampleGeojson: PreviewResult['sample_geojson'] = null
  let bbox: PreviewResult['bbox'] = null

  if (lonIdx !== -1 && latIdx !== -1) {
    const features: GeoJsonFeature[] = []
    let bMinX = Infinity
    let bMinY = Infinity
    let bMaxX = -Infinity
    let bMaxY = -Infinity

    for (const row of parsedRows) {
      const lon = parseFloat(row[lonIdx])
      const lat = parseFloat(row[latIdx])
      if (isNaN(lon) || isNaN(lat)) continue

      bMinX = Math.min(bMinX, lon)
      bMinY = Math.min(bMinY, lat)
      bMaxX = Math.max(bMaxX, lon)
      bMaxY = Math.max(bMaxY, lat)

      const properties: Record<string, unknown> = {}
      for (let j = 0; j < sanitizedHeaders.length; j++) {
        properties[sanitizedHeaders[j]] = row[j] ?? ''
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties,
      })
    }

    if (features.length > 0) {
      sampleGeojson = { type: 'FeatureCollection', features }
      bbox = [bMinX, bMinY, bMaxX, bMaxY]
    }
  }

  return {
    format: 'csv',
    feature_count: dataLines.length,
    geometry_type: geoDetect ? 'Point' : null,
    srid: null,
    fields,
    csv_info: {
      separator,
      longitude_column: geoDetect?.longitudeColumn ?? null,
      latitude_column: geoDetect?.latitudeColumn ?? null,
    },
    sample_rows: sampleRows,
    sample_geojson: sampleGeojson,
    bbox,
  }
}

async function previewShapefile(tmpPath: string): Promise<PreviewResult> {
  const vsiPath = `/vsizip/${tmpPath}`

  // List layers
  const listResult = await spawnProcess('ogrinfo', ['-json', vsiPath])
  const listData = JSON.parse(listResult.stdout)
  const layerNames: string[] = listData.layers?.map((l: { name: string }) => l.name) ?? []
  if (layerNames.length === 0) {
    throw new Error('No layers found in ZIP file')
  }
  const layerName = layerNames[0]

  // Inspect metadata
  const inspectResult = await spawnProcess('ogrinfo', ['-json', '-so', vsiPath, layerName])
  const inspectData = JSON.parse(inspectResult.stdout)
  const layer = inspectData.layers?.[0]

  const featureCount: number | null = layer?.featureCount ?? null
  const geomField = layer?.geometryFields?.[0]
  const geometryType: string | null = geomField?.type ?? null
  const projJson = geomField?.coordinateSystem?.projjson
  const srid: number | null = projJson?.id?.authority === 'EPSG' ? projJson.id.code : null

  const fields: Array<{ name: string; type: string }> = (layer?.fields ?? []).map(
    (f: { name: string; type: string }) => ({
      name: f.name,
      type: f.type,
    }),
  )

  // Sample features via ogr2ogr
  let sampleGeojson: PreviewResult['sample_geojson'] = null
  let sampleRows: Array<Record<string, unknown>> = []
  let bbox: PreviewResult['bbox'] = null

  try {
    const ogr2ogrResult = await spawnProcess('ogr2ogr', [
      '-f',
      'GeoJSON',
      '/vsistdout/',
      vsiPath,
      layerName,
      '-limit',
      '100',
      '-t_srs',
      'EPSG:4326',
    ])
    const sampleData: GeoJsonFeatureCollection = JSON.parse(ogr2ogrResult.stdout)
    if (sampleData.features && sampleData.features.length > 0) {
      sampleGeojson = { type: 'FeatureCollection', features: sampleData.features }
      sampleRows = sampleData.features.slice(0, 5).map((f) => f.properties ?? {})
      bbox = computeBbox(sampleData.features)
    }
  } catch {
    // ogr2ogr sample extraction failed — return metadata without samples
  }

  return {
    format: 'shapefile',
    feature_count: featureCount,
    geometry_type: geometryType,
    srid,
    fields,
    sample_rows: sampleRows,
    sample_geojson: sampleGeojson,
    bbox,
  }
}

export async function adminPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/admin/import/preview', {
    schema: {
      tags: ['Admin'],
      summary: 'Preview a data file before importing',
      consumes: ['multipart/form-data'],
    },
    handler: async (request, reply) => {
      const parts = request.parts()

      let fileBuffer: Buffer | undefined
      let streamedFilePath: string | undefined
      let sourceFileName: string | undefined

      mkdirSync(UPLOAD_DIR, { recursive: true })

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          sourceFileName = part.filename
          const isZip = sourceFileName?.toLowerCase().endsWith('.zip')
          if (isZip) {
            const tmpPath = join(UPLOAD_DIR, `preview_${Date.now()}.zip`)
            await pipeline(part.file, createWriteStream(tmpPath))
            if (part.file.truncated) {
              reply.status(413)
              return { statusCode: 413, error: 'Payload Too Large', message: 'File too large' }
            }
            streamedFilePath = tmpPath
          } else {
            fileBuffer = await part.toBuffer()
          }
        }
      }

      if (!fileBuffer && !streamedFilePath) {
        reply.status(400)
        return { statusCode: 400, error: 'Bad Request', message: 'No file provided' }
      }

      const isCsv = CSV_EXTENSIONS.some((ext) => sourceFileName?.toLowerCase().endsWith(ext))
      const isShapefile =
        !!streamedFilePath ||
        SHAPEFILE_EXTENSIONS.some((ext) => sourceFileName?.toLowerCase().endsWith(ext))

      try {
        let result: PreviewResult

        if (isShapefile && streamedFilePath) {
          try {
            result = await previewShapefile(streamedFilePath)
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Shapefile preview failed'
            if (msg.includes('Failed to spawn')) {
              reply.status(400)
              return {
                statusCode: 400,
                error: 'Bad Request',
                message: 'Shapefile preview requires GDAL (ogrinfo/ogr2ogr) to be installed',
              }
            }
            throw err
          } finally {
            try {
              unlinkSync(streamedFilePath)
            } catch {
              // ignore cleanup errors
            }
          }
        } else if (isCsv) {
          result = previewCsv(fileBuffer!)
        } else {
          result = previewGeoJson(fileBuffer!, sourceFileName ?? 'file.geojson')
        }

        return result
      } catch (err) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: err instanceof Error ? err.message : 'Preview failed',
        }
      }
    },
  })
}

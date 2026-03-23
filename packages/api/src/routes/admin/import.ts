import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { writeFileSync, mkdirSync, createWriteStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { gunzipSync } from 'zlib'
import PgBoss from 'pg-boss'
import { QUEUE_INGEST, IngestJobPayload } from '@sanson/worker'

interface ImportRouteOptions {
  db: Pool
  boss?: PgBoss
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{ type: string }>
}

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads'
const CSV_EXTENSIONS = ['.csv']
const SHAPEFILE_EXTENSIONS = ['.zip']

export async function adminImportRoutes(
  app: FastifyInstance,
  options: ImportRouteOptions,
): Promise<void> {
  // POST /api/admin/import
  app.post('/api/admin/import', {
    schema: {
      tags: ['Admin'],
      summary: 'Import a data file',
      description:
        'Queue an asynchronous import of a GeoJSON or CSV file into a new or existing layer',
      consumes: ['multipart/form-data'],
    },
    handler: async (request, reply) => {
      const parts = request.parts()

      let workspaceId: string | undefined
      let layerName: string | undefined
      let srid = 4326
      let separator: string | undefined
      let longitudeColumn: string | undefined
      let latitudeColumn: string | undefined
      let sourceFileName: string | undefined

      // For shapefiles we stream directly to disk (can be hundreds of MB).
      // For GeoJSON/CSV we buffer in memory (need to parse/validate/count).
      let fileBuffer: Buffer | undefined
      let streamedFilePath: string | undefined

      mkdirSync(UPLOAD_DIR, { recursive: true })

      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname === 'workspace_id') workspaceId = part.value as string
          if (part.fieldname === 'layer_name') layerName = part.value as string
          if (part.fieldname === 'srid') srid = parseInt(part.value as string, 10) || 4326
          if (part.fieldname === 'separator') separator = part.value as string
          if (part.fieldname === 'longitude') longitudeColumn = part.value as string
          if (part.fieldname === 'latitude') latitudeColumn = part.value as string
        } else if (part.type === 'file' && part.fieldname === 'file') {
          sourceFileName = part.filename
          const isZip = sourceFileName?.toLowerCase().endsWith('.zip')
          if (isZip) {
            // Stream shapefile to disk — no memory buffering
            const tmpPath = join(UPLOAD_DIR, `tmp_${Date.now()}.zip`)
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

      const hasFile = fileBuffer || streamedFilePath
      if (!workspaceId || !layerName || !hasFile) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Missing required fields: workspace_id, layer_name, file',
        }
      }

      // Detect format from file extension or content
      const isCsv = CSV_EXTENSIONS.some((ext) => sourceFileName?.toLowerCase().endsWith(ext))
      const isShapefile =
        !!streamedFilePath ||
        SHAPEFILE_EXTENSIONS.some((ext) => sourceFileName?.toLowerCase().endsWith(ext)) ||
        (fileBuffer && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b) // ZIP magic bytes (PK)

      // Verify workspace exists
      const { rows: wsRows } = await options.db.query(
        'SELECT id FROM sanson_workspaces WHERE id = $1',
        [workspaceId],
      )
      if (wsRows.length === 0) {
        reply.status(400)
        return { statusCode: 400, error: 'Bad Request', message: 'Workspace not found' }
      }

      if (!options.boss) {
        reply.status(503)
        return {
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Job queue is not available',
        }
      }

      let totalFeatures: number

      if (isShapefile) {
        // Shapefile: total_features unknown until worker inspects with ogrinfo
        totalFeatures = 0
      } else if (isCsv) {
        // CSV validation: count data rows
        const text = fileBuffer!.toString('utf-8')
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
        if (lines.length < 2) {
          reply.status(400)
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: 'CSV file must have a header row and at least one data row',
          }
        }
        totalFeatures = lines.length - 1 // exclude header
      } else {
        // GeoJSON validation
        // Decompress gzip if needed
        const isGzip =
          sourceFileName?.endsWith('.gz') ||
          (fileBuffer && fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b)
        if (isGzip) {
          try {
            fileBuffer = gunzipSync(fileBuffer!)
          } catch {
            reply.status(400)
            return {
              statusCode: 400,
              error: 'Bad Request',
              message: 'Failed to decompress gzip file',
            }
          }
        }

        let geojson: GeoJsonFeatureCollection
        try {
          geojson = JSON.parse(fileBuffer!.toString('utf-8'))
        } catch {
          reply.status(400)
          return { statusCode: 400, error: 'Bad Request', message: 'Invalid JSON file' }
        }

        if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
          reply.status(400)
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: 'File must be a GeoJSON FeatureCollection',
          }
        }

        if (geojson.features.length === 0) {
          reply.status(400)
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: 'FeatureCollection has no features',
          }
        }

        totalFeatures = geojson.features.length
      }

      // Create import history record
      const { rows: historyRows } = await options.db.query<{ id: string }>(
        `INSERT INTO sanson_import_history (source_file, source_srid, target_srid, total_features, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id`,
        [sourceFileName ?? layerName, srid, srid, totalFeatures],
      )
      const importHistoryId = historyRows[0].id

      // Save file to disk (or rename streamed file)
      const fileExt = isShapefile ? '.zip' : isCsv ? '.csv' : '.geojson'
      const filePath = join(UPLOAD_DIR, `${importHistoryId}${fileExt}`)
      if (streamedFilePath) {
        const { renameSync } = await import('fs')
        renameSync(streamedFilePath, filePath)
      } else {
        writeFileSync(filePath, fileBuffer!)
      }

      // Queue the job
      const format = isShapefile ? 'shapefile' : isCsv ? 'csv' : 'geojson'
      const payload: IngestJobPayload = {
        importHistoryId,
        filePath,
        workspaceId,
        layerName,
        srid,
        sourceFileName: sourceFileName ?? layerName,
        format,
        ...(isCsv && (separator || longitudeColumn || latitudeColumn)
          ? {
              csvOptions: {
                separator: separator ?? ';',
                longitudeColumn: longitudeColumn ?? '',
                latitudeColumn: latitudeColumn ?? '',
              },
            }
          : {}),
      }

      const jobId = await options.boss.send(QUEUE_INGEST, payload)

      // Store pg-boss job ID
      await options.db.query('UPDATE sanson_import_history SET job_id = $2 WHERE id = $1', [
        importHistoryId,
        jobId,
      ])

      reply.status(202)
      return {
        import_id: importHistoryId,
        status: 'pending',
        message: 'Import job queued',
      }
    },
  })
}

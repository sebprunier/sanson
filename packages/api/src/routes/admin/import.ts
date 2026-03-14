import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
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

export async function adminImportRoutes(
  app: FastifyInstance,
  options: ImportRouteOptions,
): Promise<void> {
  // POST /api/admin/import
  app.post('/api/admin/import', {
    schema: {
      tags: ['Admin'],
      summary: 'Import a GeoJSON file',
      description: 'Queue an asynchronous import of a GeoJSON file into a new or existing layer',
      consumes: ['multipart/form-data'],
    },
    handler: async (request, reply) => {
      const parts = request.parts()

      let workspaceId: string | undefined
      let layerName: string | undefined
      let srid = 4326
      let fileBuffer: Buffer | undefined
      let sourceFileName: string | undefined

      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname === 'workspace_id') workspaceId = part.value as string
          if (part.fieldname === 'layer_name') layerName = part.value as string
          if (part.fieldname === 'srid') srid = parseInt(part.value as string, 10) || 4326
        } else if (part.type === 'file' && part.fieldname === 'file') {
          sourceFileName = part.filename
          fileBuffer = await part.toBuffer()
        }
      }

      if (!workspaceId || !layerName || !fileBuffer) {
        reply.status(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Missing required fields: workspace_id, layer_name, file',
        }
      }

      // Validate GeoJSON structure
      let geojson: GeoJsonFeatureCollection
      try {
        geojson = JSON.parse(fileBuffer.toString('utf-8'))
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

      // Create import history record
      const { rows: historyRows } = await options.db.query<{ id: string }>(
        `INSERT INTO sanson_import_history (source_file, source_srid, target_srid, total_features, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id`,
        [sourceFileName ?? layerName, srid, srid, geojson.features.length],
      )
      const importHistoryId = historyRows[0].id

      // Save file to disk
      mkdirSync(UPLOAD_DIR, { recursive: true })
      const filePath = join(UPLOAD_DIR, `${importHistoryId}.geojson`)
      writeFileSync(filePath, fileBuffer)

      // Queue the job
      const payload: IngestJobPayload = {
        importHistoryId,
        filePath,
        workspaceId,
        layerName,
        srid,
        sourceFileName: sourceFileName ?? layerName,
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

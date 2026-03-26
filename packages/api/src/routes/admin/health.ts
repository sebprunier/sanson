import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { spawnProcess } from '@sanson/core'

interface HealthRouteOptions {
  db: Pool
}

const startedAt = Date.now()

export async function adminHealthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  app.get('/api/admin/health', {
    schema: {
      tags: ['Admin'],
      summary: 'Detailed health check',
      description:
        'Returns detailed health information about the server, database, jobs, and dependencies',
    },
    handler: async () => {
      const mem = process.memoryUsage()
      const nodeMode = process.env.NODE_MODE ?? 'all'

      // Server info
      const server = {
        version: '0.1.0',
        node_version: process.version,
        node_mode: nodeMode,
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        memory: {
          rss_mb: Math.round(mem.rss / 1024 / 1024),
          heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        },
      }

      // Database info
      let database: Record<string, unknown>
      try {
        const [pgVersionResult, postgisVersionResult, dbSizeResult, connectionsResult] =
          await Promise.all([
            options.db.query('SELECT version()'),
            options.db.query('SELECT PostGIS_Version() AS version'),
            options.db.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS size'),
            options.db.query(`
              SELECT
                (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS active,
                (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max
            `),
          ])

        database = {
          status: 'ok',
          postgresql_version: pgVersionResult.rows[0].version.split(',')[0],
          postgis_version: postgisVersionResult.rows[0].version,
          database_size: dbSizeResult.rows[0].size,
          connections: {
            active: parseInt(connectionsResult.rows[0].active, 10),
            max: connectionsResult.rows[0].max,
          },
        }
      } catch (err) {
        database = {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }
      }

      // Jobs summary
      let jobs: Record<string, unknown>
      try {
        const [countsResult, lastJobResult] = await Promise.all([
          options.db.query(`
            SELECT
              count(*) FILTER (WHERE status = 'pending') AS pending,
              count(*) FILTER (WHERE status = 'running') AS running,
              count(*) FILTER (WHERE status = 'completed') AS completed,
              count(*) FILTER (WHERE status = 'failed') AS failed
            FROM sanson_import_history
          `),
          options.db.query(`
            SELECT status, source_file, duration_ms, completed_at
            FROM sanson_import_history
            WHERE completed_at IS NOT NULL
            ORDER BY completed_at DESC
            LIMIT 1
          `),
        ])

        const counts = countsResult.rows[0]
        const lastJob = lastJobResult.rows[0] ?? null

        jobs = {
          pending: parseInt(counts.pending, 10),
          running: parseInt(counts.running, 10),
          completed: parseInt(counts.completed, 10),
          failed: parseInt(counts.failed, 10),
          last_completed: lastJob
            ? {
                source_file: lastJob.source_file,
                status: lastJob.status,
                duration_ms: lastJob.duration_ms,
                completed_at: lastJob.completed_at,
              }
            : null,
        }
      } catch {
        jobs = { pending: 0, running: 0, completed: 0, failed: 0, last_completed: null }
      }

      // GDAL / ogr2ogr
      let gdal: Record<string, unknown>
      try {
        const result = await spawnProcess('ogrinfo', ['--version'])
        gdal = {
          available: true,
          version: result.stdout.trim(),
        }
      } catch {
        gdal = {
          available: false,
          version: null,
        }
      }

      return { server, database, jobs, gdal }
    },
  })
}

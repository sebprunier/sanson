import { Pool } from 'pg'
import { buildApp } from './app'
import { createBoss, startWorker, ensureQueues } from '@sanson/worker'
import type { BossConfig } from '@sanson/worker'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Missing DATABASE_URL environment variable')
  process.exit(1)
}

const port = parseInt(process.env.PORT ?? '3000', 10)
const nodeMode = process.env.NODE_MODE ?? 'all'

if (!['api', 'worker', 'all'].includes(nodeMode)) {
  console.error(`Invalid NODE_MODE: ${nodeMode}. Must be 'api', 'worker', or 'all'.`)
  process.exit(1)
}

const db = new Pool({ connectionString })

// Load job queue config from database (falls back to defaults if table does not exist yet)
async function loadBossConfig(): Promise<BossConfig> {
  try {
    const { rows } = await db.query<{ key: string; value: string }>(
      "SELECT key, value FROM sanson_config WHERE key LIKE 'jobs.%'",
    )
    const map = new Map(rows.map((r) => [r.key, r.value]))
    return {
      retryLimit: map.has('jobs.retry_limit')
        ? parseInt(map.get('jobs.retry_limit')!, 10)
        : undefined,
      retryDelay: map.has('jobs.retry_delay_seconds')
        ? parseInt(map.get('jobs.retry_delay_seconds')!, 10)
        : undefined,
      expireInHours: map.has('jobs.expire_hours')
        ? parseInt(map.get('jobs.expire_hours')!, 10)
        : undefined,
      archiveCompletedAfterSeconds: map.has('jobs.archive_days')
        ? parseInt(map.get('jobs.archive_days')!, 10) * 24 * 60 * 60
        : undefined,
    }
  } catch {
    return {}
  }
}

const bossConfig = await loadBossConfig()
const boss = createBoss(connectionString, bossConfig)

// Load upload config
let maxFileSizeMb: number | undefined
try {
  const { rows } = await db.query<{ value: string }>(
    "SELECT value FROM sanson_config WHERE key = 'upload.max_file_size_mb'",
  )
  if (rows[0]) maxFileSizeMb = parseInt(rows[0].value, 10)
} catch {
  // table may not exist yet
}

const shutdown = async () => {
  await boss.stop({ graceful: true })
  await db.end()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

try {
  await boss.start()
  await ensureQueues(boss)
  console.log(`pg-boss started (schema: pgboss)`)

  if (nodeMode === 'api' || nodeMode === 'all') {
    const app = buildApp(db, {
      logger: true,
      boss,
      maxFileSizeMb,
      adminUiDir: process.env.ADMIN_UI_DIR,
    })
    app.addHook('onClose', async () => {
      await boss.stop({ graceful: true })
    })
    await app.listen({ port, host: '0.0.0.0' })
  }

  if (nodeMode === 'worker' || nodeMode === 'all') {
    await startWorker(boss, db)
    console.log(`Worker started, listening on queue: sanson-ingest`)
  }

  if (nodeMode === 'worker') {
    console.log('Running in worker-only mode (no HTTP server)')
  }
} catch (err) {
  console.error(err)
  process.exit(1)
}

import PgBoss from 'pg-boss'
import { Pool } from 'pg'
import { QUEUE_INGEST, IngestJobPayload } from './boss'
import { handleIngest } from './handlers/ingest'
import { updateProgress } from './utils/progress'

export { createBoss, QUEUE_INGEST } from './boss'
export type { IngestJobPayload } from './boss'

export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE_INGEST)
}

export async function startWorker(boss: PgBoss, db: Pool): Promise<void> {
  await ensureQueues(boss)
  await boss.work<IngestJobPayload>(QUEUE_INGEST, async ([job]) => {
    try {
      await handleIngest(db, job.data)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await updateProgress(db, job.data.importHistoryId, {
        status: 'failed',
        completed_at: true,
        error: message,
        log: { level: 'error', message: `Import failed: ${message}` },
      })
      throw err // pg-boss will handle retry
    }
  })
}

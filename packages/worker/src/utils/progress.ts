import { Pool } from 'pg'

interface LogEntry {
  ts: string
  level: string
  message: string
}

export async function updateProgress(
  db: Pool,
  importHistoryId: string,
  data: {
    progress?: number
    imported_features?: number
    status?: string
    error?: string
    log?: { level: string; message: string }
    started_at?: boolean
    completed_at?: boolean
  },
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = [importHistoryId]
  let idx = 2

  if (data.progress != null) {
    sets.push(`progress = $${idx++}`)
    values.push(data.progress)
  }
  if (data.imported_features != null) {
    sets.push(`imported_features = $${idx++}`)
    values.push(data.imported_features)
  }
  if (data.status != null) {
    sets.push(`status = $${idx++}`)
    values.push(data.status)
  }
  if (data.error != null) {
    sets.push(`error = $${idx++}`)
    values.push(data.error)
  }
  if (data.started_at) {
    sets.push('started_at = now()')
  }
  if (data.completed_at) {
    sets.push('completed_at = now()')
  }
  if (data.log) {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level: data.log.level,
      message: data.log.message,
    }
    sets.push(`logs = logs || $${idx++}::jsonb`)
    values.push(JSON.stringify([entry]))
  }

  if (sets.length === 0) return

  await db.query(`UPDATE sanson_import_history SET ${sets.join(', ')} WHERE id = $1`, values)
}

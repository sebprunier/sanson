import { Pool } from 'pg'

export interface ConfigEntry {
  key: string
  value: string
  category: string
  label: string
  description: string | null
  restart: boolean
  updated_at: string
}

const DEFAULTS: Record<string, string> = {
  'upload.max_file_size_mb': '1024',
  'import.batch_size': '500',
  'import.csv_inference_rows': '100',
  'import.default_srid': '4326',
  'jobs.retry_limit': '3',
  'jobs.retry_delay_seconds': '30',
  'jobs.expire_hours': '2',
  'jobs.archive_days': '7',
  'tiles.cache_ttl_seconds': '3600',
}

export async function getConfigValue(db: Pool, key: string): Promise<string> {
  const { rows } = await db.query<{ value: string }>(
    'SELECT value FROM sanson_config WHERE key = $1',
    [key],
  )
  return rows[0]?.value ?? DEFAULTS[key] ?? ''
}

export async function getConfigNumber(db: Pool, key: string): Promise<number> {
  const val = await getConfigValue(db, key)
  return parseInt(val, 10)
}

export async function getAllConfig(db: Pool): Promise<ConfigEntry[]> {
  const { rows } = await db.query<ConfigEntry>(
    'SELECT key, value, category, label, description, restart, updated_at FROM sanson_config ORDER BY category, key',
  )
  return rows
}

export async function updateConfig(
  db: Pool,
  updates: Array<{ key: string; value: string }>,
): Promise<ConfigEntry[]> {
  for (const { key, value } of updates) {
    await db.query('UPDATE sanson_config SET value = $1, updated_at = now() WHERE key = $2', [
      value,
      key,
    ])
  }
  return getAllConfig(db)
}

import PgBoss from 'pg-boss'

export interface BossConfig {
  retryLimit?: number
  retryDelay?: number
  expireInHours?: number
  archiveCompletedAfterSeconds?: number
}

export function createBoss(connectionString: string, config: BossConfig = {}): PgBoss {
  return new PgBoss({
    connectionString,
    schema: 'pgboss',
    retryLimit: config.retryLimit ?? 3,
    retryDelay: config.retryDelay ?? 30,
    expireInHours: config.expireInHours ?? 2,
    archiveCompletedAfterSeconds: config.archiveCompletedAfterSeconds ?? 7 * 24 * 60 * 60,
  })
}

export const QUEUE_INGEST = 'sanson-ingest'

export interface IngestJobPayload {
  importHistoryId: string
  filePath: string
  workspaceId: string
  collectionName: string
  srid: number
  sourceFileName: string
  format?: 'geojson' | 'csv' | 'shapefile'
  csvOptions?: {
    separator: string
    longitudeColumn: string
    latitudeColumn: string
  }
}

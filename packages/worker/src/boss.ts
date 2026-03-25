import PgBoss from 'pg-boss'

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({
    connectionString,
    schema: 'pgboss',
    retryLimit: 3,
    retryDelay: 30,
    expireInHours: 2,
    archiveCompletedAfterSeconds: 7 * 24 * 60 * 60,
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

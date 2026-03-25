import { readFileSync, unlinkSync } from 'fs'
import { Pool } from 'pg'
import { IngestJobPayload } from '../boss'
import { updateProgress } from '../utils/progress'
import { handleCsvIngest } from './ingest-csv'
import { handleShapefileIngest } from './ingest-shapefile'
import { sanitizeColumnName } from '@sanson/core'
import type { GeoJsonFeatureCollection } from '@sanson/core'

const BATCH_SIZE = 500

function inferGeoJsonSqlType(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'DOUBLE PRECISION'
  }
  if (typeof value === 'boolean') return 'BOOLEAN'
  return 'TEXT'
}

function toMultiType(geomType: string): string {
  if (geomType.startsWith('Multi')) return geomType
  return `Multi${geomType}`
}

export async function handleIngest(db: Pool, payload: IngestJobPayload): Promise<void> {
  // Dispatch to format-specific handlers
  if (payload.format === 'shapefile') {
    return handleShapefileIngest(db, payload)
  }
  if (payload.format === 'csv') {
    return handleCsvIngest(db, payload)
  }

  const { importHistoryId, filePath, workspaceId, collectionName, srid, sourceFileName } = payload

  await updateProgress(db, importHistoryId, {
    status: 'running',
    started_at: true,
    log: { level: 'info', message: `Starting import of ${sourceFileName}` },
  })

  // Read and parse GeoJSON
  const raw = readFileSync(filePath, 'utf-8')
  const geojson: GeoJsonFeatureCollection = JSON.parse(raw)

  const totalFeatures = geojson.features.length
  await updateProgress(db, importHistoryId, {
    log: { level: 'info', message: `Parsed ${totalFeatures} features` },
  })

  // Update total_features
  await db.query('UPDATE sanson_import_history SET total_features = $2 WHERE id = $1', [
    importHistoryId,
    totalFeatures,
  ])

  // Detect geometry type and columns from first feature
  // Always promote to Multi variant to handle mixed Polygon/MultiPolygon etc.
  const geometryType = toMultiType(geojson.features[0].geometry!.type)
  const firstProps = geojson.features[0].properties || {}
  const columns = Object.entries(firstProps).map(([key, value]) => ({
    name: sanitizeColumnName(key),
    originalName: key,
    type: inferGeoJsonSqlType(value),
  }))

  // Build table name
  const tableName = `data_${sanitizeColumnName(collectionName)}`

  // Check if table already exists (re-import)
  const { rows: tableCheck } = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [tableName],
  )
  if (tableCheck.length > 0) {
    // Re-import: drop and recreate to handle schema changes
    await db.query(`DROP TABLE ${tableName}`)
    await updateProgress(db, importHistoryId, {
      log: { level: 'info', message: `Existing table ${tableName} dropped (re-import)` },
    })
  }

  // Create table
  const columnDefs = columns.map((c) => `${c.name} ${c.type}`).join(', ')
  await db.query(`
    CREATE TABLE ${tableName} (
      id SERIAL PRIMARY KEY,
      geom GEOMETRY(${geometryType}, ${srid})
      ${columnDefs ? ', ' + columnDefs : ''}
    )
  `)

  // Create spatial index
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_${tableName}_geom ON ${tableName} USING GIST (geom)`,
  )

  await updateProgress(db, importHistoryId, {
    log: { level: 'info', message: `Table ${tableName} ready` },
  })

  // Insert features in batches
  let insertedCount = 0
  for (let i = 0; i < geojson.features.length; i++) {
    const feature = geojson.features[i]
    const props = feature.properties || {}
    const colNames = columns.map((c) => c.name)
    const colValues = columns.map((c) => props[c.originalName] ?? null)
    const placeholders = columns.map((_, j) => `$${j + 2}`)

    await db.query(
      `INSERT INTO ${tableName} (geom, ${colNames.join(', ')})
       VALUES (ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), ${srid})), ${placeholders.join(', ')})`,
      [JSON.stringify(feature.geometry), ...colValues],
    )
    insertedCount++

    // Update progress every BATCH_SIZE features
    if (insertedCount % BATCH_SIZE === 0 || insertedCount === totalFeatures) {
      const progress = Math.round((insertedCount / totalFeatures) * 100)
      await updateProgress(db, importHistoryId, {
        progress,
        imported_features: insertedCount,
        log: {
          level: 'info',
          message: `${insertedCount}/${totalFeatures} features imported`,
        },
      })
    }
  }

  // Compute bbox
  const { rows: bboxRows } = await db.query(
    `SELECT ST_Extent(ST_Transform(geom, 4326))::text AS bbox FROM ${tableName}`,
  )
  let bbox: number[] | null = null
  if (bboxRows[0]?.bbox) {
    const match = bboxRows[0].bbox.match(/BOX\((.+?) (.+?),(.+?) (.+?)\)/)
    if (match) {
      bbox = [
        parseFloat(match[1]),
        parseFloat(match[2]),
        parseFloat(match[3]),
        parseFloat(match[4]),
      ]
    }
  }

  // Register or update collection
  const { rows: existingCollection } = await db.query(
    'SELECT id FROM sanson_collections WHERE workspace_id = $1 AND name = $2',
    [workspaceId, collectionName],
  )

  let collectionId: string
  if (existingCollection.length > 0) {
    collectionId = existingCollection[0].id
    await db.query(
      `UPDATE sanson_collections
       SET bbox = $2, feature_count = $3, geometry_type = $4, updated_at = now()
       WHERE id = $1`,
      [collectionId, JSON.stringify(bbox), insertedCount, geometryType],
    )
  } else {
    const { rows: newCollection } = await db.query(
      `INSERT INTO sanson_collections (workspace_id, name, table_name, geometry_column, id_column, srid, bbox, feature_count, geometry_type)
       VALUES ($1, $2, $3, 'geom', 'id', $4, $5, $6, $7)
       RETURNING id`,
      [
        workspaceId,
        collectionName,
        tableName,
        srid,
        JSON.stringify(bbox),
        insertedCount,
        geometryType,
      ],
    )
    collectionId = newCollection[0].id
  }

  // Link collection to import history
  await db.query('UPDATE sanson_import_history SET collection_id = $2 WHERE id = $1', [
    importHistoryId,
    collectionId,
  ])

  // Compute duration
  const { rows: historyRows } = await db.query(
    'SELECT created_at FROM sanson_import_history WHERE id = $1',
    [importHistoryId],
  )
  const durationMs = Date.now() - new Date(historyRows[0].created_at).getTime()

  // Mark completed
  await updateProgress(db, importHistoryId, {
    status: 'completed',
    progress: 100,
    imported_features: insertedCount,
    completed_at: true,
    log: { level: 'info', message: `Import completed: ${insertedCount} features` },
  })
  await db.query(
    'UPDATE sanson_import_history SET feature_count = $2, duration_ms = $3 WHERE id = $1',
    [importHistoryId, insertedCount, durationMs],
  )

  // Cleanup uploaded file
  try {
    unlinkSync(filePath)
  } catch {
    // File may already be cleaned up
  }
}

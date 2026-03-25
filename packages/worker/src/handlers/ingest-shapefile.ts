import { unlinkSync } from 'fs'
import { Pool } from 'pg'
import { IngestJobPayload } from '../boss'
import { updateProgress } from '../utils/progress'
import { spawnProcess } from '../utils/exec'

interface OgrLayerInfo {
  featureCount: number
  geometryType: string
  sourceSrid: number | null
  fields: Array<{ name: string; type: string }>
}

function toMultiType(geomType: string): string {
  if (geomType.startsWith('Multi')) return geomType
  return `Multi${geomType}`
}

function sanitizeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
}

function buildPgConnectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL environment variable is required for Shapefile import')

  // Parse the URI and build a key=value connection string for ogr2ogr
  // This avoids issues with spaces in application_name that GDAL adds to URI format
  const parsed = new URL(url)
  const parts = [
    `host=${parsed.hostname}`,
    `port=${parsed.port || '5432'}`,
    `dbname=${parsed.pathname.slice(1)}`,
    `user=${decodeURIComponent(parsed.username)}`,
  ]
  if (parsed.password) {
    parts.push(`password=${decodeURIComponent(parsed.password)}`)
  }
  return `PG:${parts.join(' ')}`
}

async function inspectShapefile(vsiPath: string, layerName: string): Promise<OgrLayerInfo> {
  const result = await spawnProcess('ogrinfo', ['-json', '-so', vsiPath, layerName])
  const data = JSON.parse(result.stdout)

  const layer = data.layers?.[0]
  if (!layer) throw new Error('No layers found in shapefile')

  const geomField = layer.geometryFields?.[0]
  if (!geomField) throw new Error('No geometry field found in shapefile')

  // Extract SRID from projjson.id
  let sourceSrid: number | null = null
  const projjson = geomField.coordinateSystem?.projjson
  if (projjson?.id?.authority === 'EPSG') {
    sourceSrid = projjson.id.code
  }

  return {
    featureCount: layer.featureCount ?? 0,
    geometryType: geomField.type,
    sourceSrid,
    fields: (layer.fields ?? []).map((f: { name: string; type: string }) => ({
      name: f.name,
      type: f.type,
    })),
  }
}

function parseOgr2ogrProgress(chunk: string): number | null {
  // ogr2ogr -progress outputs: "0...10...20...30...40...50...60...70...80...90...100 - done."
  const matches = chunk.match(/(\d+)\.\.\./g)
  if (!matches) {
    // Also check for the final "100 - done." pattern
    if (chunk.includes('100 - done')) return 100
    return null
  }
  let lastProgress = 0
  for (const m of matches) {
    const num = parseInt(m, 10)
    if (num > lastProgress) lastProgress = num
  }
  return lastProgress
}

async function listZipLayers(vsiPath: string): Promise<string[]> {
  const result = await spawnProcess('ogrinfo', ['-json', vsiPath])
  const data = JSON.parse(result.stdout)
  return (data.layers ?? []).map((l: { name: string }) => l.name)
}

export async function handleShapefileIngest(db: Pool, payload: IngestJobPayload): Promise<void> {
  const { importHistoryId, filePath, workspaceId, collectionName, srid, sourceFileName } = payload

  await updateProgress(db, importHistoryId, {
    status: 'running',
    started_at: true,
    log: { level: 'info', message: `Starting Shapefile import of ${sourceFileName}` },
  })

  // Phase A: Inspect with ogrinfo
  const vsiPath = `/vsizip/${filePath}`
  const layers = await listZipLayers(vsiPath)

  if (layers.length === 0) {
    throw new Error('No layers found in ZIP file. Ensure it contains a valid Shapefile (.shp)')
  }

  if (layers.length > 1) {
    await updateProgress(db, importHistoryId, {
      log: {
        level: 'warn',
        message: `ZIP contains ${layers.length} layers (${layers.join(', ')}). Importing first layer only: ${layers[0]}`,
      },
    })
  }

  const shapefileLayerName = layers[0]
  const info = await inspectShapefile(vsiPath, shapefileLayerName)
  const geometryType = toMultiType(info.geometryType)

  await updateProgress(db, importHistoryId, {
    log: {
      level: 'info',
      message: `Detected: ${info.featureCount} features, ${info.geometryType}${info.sourceSrid ? `, EPSG:${info.sourceSrid}` : ', unknown SRID'}`,
    },
  })

  // Update total_features
  await db.query('UPDATE sanson_import_history SET total_features = $2 WHERE id = $1', [
    importHistoryId,
    info.featureCount,
  ])

  if (!info.sourceSrid) {
    await updateProgress(db, importHistoryId, {
      log: {
        level: 'warn',
        message: `No SRID detected from .prj file. Using target SRID ${srid} as source SRID.`,
      },
    })
  }

  // Phase B: Prepare table name
  const tableName = `data_${sanitizeTableName(collectionName)}`

  // Drop existing table (re-import safety)
  const { rows: tableCheck } = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [tableName],
  )
  if (tableCheck.length > 0) {
    await db.query(`DROP TABLE ${tableName}`)
    await updateProgress(db, importHistoryId, {
      log: { level: 'info', message: `Existing table ${tableName} dropped (re-import)` },
    })
  }

  // Phase C: Run ogr2ogr
  const pgConn = buildPgConnectionString()
  const targetSrid = srid || 4326

  const ogr2ogrArgs = [
    '-f',
    'PostgreSQL',
    pgConn,
    vsiPath,
    shapefileLayerName,
    '-nln',
    tableName,
    '-nlt',
    'PROMOTE_TO_MULTI',
    '-t_srs',
    `EPSG:${targetSrid}`,
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'FID=id',
    '-lco',
    'PRECISION=NO',
    '-lco',
    'SPATIAL_INDEX=NO',
    '-overwrite',
    '--config',
    'PG_USE_COPY',
    'YES',
    '-progress',
  ]

  await updateProgress(db, importHistoryId, {
    log: { level: 'info', message: `Running ogr2ogr: reprojecting to EPSG:${targetSrid}` },
  })

  // Phase D: Track progress from ogr2ogr stderr
  let lastReportedProgress = 0

  await spawnProcess('ogr2ogr', ogr2ogrArgs, async (chunk) => {
    const progress = parseOgr2ogrProgress(chunk)
    if (progress !== null && progress > lastReportedProgress) {
      lastReportedProgress = progress
      const estimatedFeatures = Math.round((progress / 100) * info.featureCount)
      // Fire-and-forget progress update (don't await in the callback)
      updateProgress(db, importHistoryId, {
        progress,
        imported_features: estimatedFeatures,
        log: {
          level: 'info',
          message: `ogr2ogr: ${progress}% (${estimatedFeatures}/${info.featureCount} features)`,
        },
      }).catch(() => {})
    }
  })

  await updateProgress(db, importHistoryId, {
    log: { level: 'info', message: 'ogr2ogr completed successfully' },
  })

  // Phase E: Post-import metadata

  // Create spatial index with our naming convention
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_${tableName}_geom ON ${tableName} USING GIST (geom)`,
  )

  // Get actual feature count
  const { rows: countRows } = await db.query(`SELECT COUNT(*) AS cnt FROM ${tableName}`)
  const featureCount = parseInt(countRows[0].cnt, 10)

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
  // Use geometryType from ogrinfo (mixed case e.g. "MultiPolygon") rather than
  // PostGIS GeometryType() which returns uppercase ("MULTIPOLYGON")
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
      [collectionId, JSON.stringify(bbox), featureCount, geometryType],
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
        targetSrid,
        JSON.stringify(bbox),
        featureCount,
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
    imported_features: featureCount,
    completed_at: true,
    log: { level: 'info', message: `Import completed: ${featureCount} features` },
  })
  await db.query(
    'UPDATE sanson_import_history SET feature_count = $2, duration_ms = $3 WHERE id = $1',
    [importHistoryId, featureCount, durationMs],
  )

  // Phase F: Cleanup uploaded file
  try {
    unlinkSync(filePath)
  } catch {
    // File may already be cleaned up
  }
}

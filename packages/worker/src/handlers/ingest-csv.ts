import { readFileSync, unlinkSync } from 'fs'
import { Pool } from 'pg'
import { IngestJobPayload } from '../boss'
import { updateProgress } from '../utils/progress'

const BATCH_SIZE = 500

const RESERVED_COLUMNS = new Set(['id', 'geom'])

function sanitizeColumnName(name: string): string {
  let col = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
  if (RESERVED_COLUMNS.has(col)) col = `_${col}`
  return col
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function detectSeparator(headerLine: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  for (const ch of headerLine) {
    if (ch in counts) counts[ch]++
  }
  let best = ';'
  let max = 0
  for (const [ch, count] of Object.entries(counts)) {
    if (count > max) {
      max = count
      best = ch
    }
  }
  return best
}

// Ordered by priority — explicit WGS84 names first, generic names last
const LON_NAMES_BY_PRIORITY: string[][] = [
  ['longitude', 'lon', 'lng', 'long'],
  ['x_wgs84'],
  ['x', 'centroid_x'],
]
const LAT_NAMES_BY_PRIORITY: string[][] = [['latitude', 'lat'], ['y_wgs84'], ['y', 'centroid_y']]

function autoDetectGeoColumns(
  headers: string[],
): { longitudeColumn: string; latitudeColumn: string } | null {
  const lower = headers.map((h) => h.toLowerCase().trim())

  function findByPriority(priorities: string[][]): string | null {
    for (const group of priorities) {
      const set = new Set(group)
      const idx = lower.findIndex((h) => set.has(h))
      if (idx !== -1) return headers[idx]
    }
    return null
  }

  const lonCol = findByPriority(LON_NAMES_BY_PRIORITY)
  const latCol = findByPriority(LAT_NAMES_BY_PRIORITY)
  if (lonCol && latCol) return { longitudeColumn: lonCol, latitudeColumn: latCol }
  return null
}

function inferSqlType(values: string[]): string {
  let allNumeric = true
  let hasFloat = false
  for (const v of values) {
    if (v === '') continue
    if (isNaN(Number(v))) {
      allNumeric = false
      break
    }
    if (v.includes('.')) hasFloat = true
  }
  if (allNumeric && values.some((v) => v !== '')) {
    return hasFloat ? 'DOUBLE PRECISION' : 'INTEGER'
  }
  return 'TEXT'
}

function parseCsvLine(line: string, separator: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === separator) {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)
  return fields
}

export async function handleCsvIngest(db: Pool, payload: IngestJobPayload): Promise<void> {
  const { importHistoryId, filePath, workspaceId, layerName, srid, sourceFileName, csvOptions } =
    payload

  await updateProgress(db, importHistoryId, {
    status: 'running',
    started_at: true,
    log: { level: 'info', message: `Starting CSV import of ${sourceFileName}` },
  })

  // Read file
  const raw = stripBom(readFileSync(filePath, 'utf-8'))
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '')

  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row')
  }

  // Parse header
  const separator = csvOptions?.separator ?? detectSeparator(lines[0])
  const headers = parseCsvLine(lines[0], separator)

  await updateProgress(db, importHistoryId, {
    log: {
      level: 'info',
      message: `Detected ${headers.length} columns, separator: "${separator === '\t' ? 'TAB' : separator}"`,
    },
  })

  // Detect geometry columns
  let lonCol: string
  let latCol: string
  if (csvOptions?.longitudeColumn && csvOptions?.latitudeColumn) {
    lonCol = csvOptions.longitudeColumn
    latCol = csvOptions.latitudeColumn
  } else {
    const detected = autoDetectGeoColumns(headers)
    if (!detected) {
      throw new Error(
        'Could not auto-detect longitude/latitude columns. Please specify them explicitly.',
      )
    }
    lonCol = detected.longitudeColumn
    latCol = detected.latitudeColumn
  }

  const lonIdx = headers.findIndex((h) => h === lonCol)
  const latIdx = headers.findIndex((h) => h === latCol)
  if (lonIdx === -1) throw new Error(`Longitude column not found: "${lonCol}"`)
  if (latIdx === -1) throw new Error(`Latitude column not found: "${latCol}"`)

  await updateProgress(db, importHistoryId, {
    log: { level: 'info', message: `Geometry: lon="${lonCol}", lat="${latCol}"` },
  })

  // Parse all data rows
  const dataRows = lines.slice(1).map((line) => parseCsvLine(line, separator))
  const totalFeatures = dataRows.length

  await db.query('UPDATE sanson_import_history SET total_features = $2 WHERE id = $1', [
    importHistoryId,
    totalFeatures,
  ])

  await updateProgress(db, importHistoryId, {
    log: { level: 'info', message: `Parsed ${totalFeatures} rows` },
  })

  // Determine property columns (exclude lon/lat)
  const propIndices: number[] = []
  const propHeaders: string[] = []
  for (let i = 0; i < headers.length; i++) {
    if (i !== lonIdx && i !== latIdx) {
      propIndices.push(i)
      propHeaders.push(headers[i])
    }
  }

  // Infer column types from first 100 rows
  const sampleSize = Math.min(100, dataRows.length)
  const columns = propHeaders.map((header, ci) => {
    const sampleValues = dataRows.slice(0, sampleSize).map((row) => row[propIndices[ci]] ?? '')
    return {
      name: sanitizeColumnName(header),
      originalIndex: propIndices[ci],
      type: inferSqlType(sampleValues),
    }
  })

  // Build table
  const tableName = `data_${sanitizeColumnName(layerName)}`

  // Check if table already exists (re-import)
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

  const columnDefs = columns.map((c) => `${c.name} ${c.type}`).join(', ')
  await db.query(`
    CREATE TABLE ${tableName} (
      id SERIAL PRIMARY KEY,
      geom GEOMETRY(MultiPoint, ${srid})
      ${columnDefs ? ', ' + columnDefs : ''}
    )
  `)
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_${tableName}_geom ON ${tableName} USING GIST (geom)`,
  )

  await updateProgress(db, importHistoryId, {
    log: { level: 'info', message: `Table ${tableName} ready` },
  })

  // Insert rows
  let insertedCount = 0
  let skippedCount = 0
  for (const row of dataRows) {
    const lonVal = parseFloat(row[lonIdx])
    const latVal = parseFloat(row[latIdx])
    if (isNaN(lonVal) || isNaN(latVal)) {
      skippedCount++
      continue
    }

    const colNames = columns.map((c) => c.name)
    const colValues = columns.map((c) => {
      const val = row[c.originalIndex] ?? ''
      if (val === '') return null
      if (c.type === 'INTEGER') return parseInt(val, 10)
      if (c.type === 'DOUBLE PRECISION') return parseFloat(val)
      return val
    })
    const placeholders = columns.map((_, j) => `$${j + 3}`)

    await db.query(
      `INSERT INTO ${tableName} (geom, ${colNames.join(', ')})
       VALUES (ST_Multi(ST_SetSRID(ST_MakePoint($1, $2), ${srid})), ${placeholders.join(', ')})`,
      [lonVal, latVal, ...colValues],
    )
    insertedCount++

    if (insertedCount % BATCH_SIZE === 0 || insertedCount + skippedCount === totalFeatures) {
      const progress = Math.round(((insertedCount + skippedCount) / totalFeatures) * 100)
      await updateProgress(db, importHistoryId, {
        progress,
        imported_features: insertedCount,
        log: {
          level: 'info',
          message: `${insertedCount}/${totalFeatures} rows imported${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`,
        },
      })
    }
  }

  if (skippedCount > 0) {
    await updateProgress(db, importHistoryId, {
      log: {
        level: 'warn',
        message: `${skippedCount} rows skipped (missing or invalid coordinates)`,
      },
    })
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

  // Register or update layer
  const { rows: existingLayer } = await db.query(
    'SELECT id FROM sanson_layers WHERE workspace_id = $1 AND name = $2',
    [workspaceId, layerName],
  )

  let layerId: string
  if (existingLayer.length > 0) {
    layerId = existingLayer[0].id
    await db.query(
      `UPDATE sanson_layers
       SET bbox = $2, feature_count = $3, geometry_type = 'MultiPoint', updated_at = now()
       WHERE id = $1`,
      [layerId, JSON.stringify(bbox), insertedCount],
    )
  } else {
    const { rows: newLayer } = await db.query(
      `INSERT INTO sanson_layers (workspace_id, name, table_name, geometry_column, id_column, srid, bbox, feature_count, geometry_type)
       VALUES ($1, $2, $3, 'geom', 'id', $4, $5, $6, 'MultiPoint')
       RETURNING id`,
      [workspaceId, layerName, tableName, srid, JSON.stringify(bbox), insertedCount],
    )
    layerId = newLayer[0].id
  }

  // Link layer to import history
  await db.query('UPDATE sanson_import_history SET layer_id = $2 WHERE id = $1', [
    importHistoryId,
    layerId,
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
    log: {
      level: 'info',
      message: `Import completed: ${insertedCount} rows${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}`,
    },
  })
  await db.query(
    'UPDATE sanson_import_history SET feature_count = $2, duration_ms = $3 WHERE id = $1',
    [importHistoryId, insertedCount, durationMs],
  )

  // Cleanup
  try {
    unlinkSync(filePath)
  } catch {
    // File may already be cleaned up
  }
}

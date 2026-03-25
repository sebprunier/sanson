const RESERVED_COLUMNS = new Set(['id', 'geom'])

export function sanitizeColumnName(name: string): string {
  let col = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
  if (RESERVED_COLUMNS.has(col)) col = `_${col}`
  return col
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function detectSeparator(headerLine: string): string {
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

export function autoDetectGeoColumns(
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

export function inferSqlType(values: string[]): string {
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

export function parseCsvLine(line: string, separator: string): string[] {
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

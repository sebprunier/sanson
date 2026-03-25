/**
 * CQL2 JSON parser — converts a CQL2 JSON expression to a SQL WHERE clause.
 *
 * Supported operators:
 * - Comparison: =, <>, <, <=, >, >=
 * - Logic: and, or, not
 * - Text: like (+ casei for case-insensitive)
 * - Null: isNull
 * - List: in
 * - Range: between
 * - Spatial: s_intersects, s_within, s_contains, s_touches, s_crosses, s_overlaps, s_equals, s_disjoint
 * - Temporal: t_after, t_before, t_during, t_equals, t_intersects, t_disjoint
 */

import type { CqlResult, CqlParseOptions } from './types'

type CqlJsonExpr =
  | { op: string; args: unknown[] }
  | { property: string }
  | string
  | number
  | boolean

const COMPARISON_OPS = new Set(['=', '<>', '<', '<=', '>', '>='])

const TEMPORAL_INSTANT_OPS = new Set(['t_before', 't_after', 't_equals'])
const TEMPORAL_INTERVAL_OPS = new Set(['t_during', 't_intersects', 't_disjoint'])

const SPATIAL_OPS: Record<string, string> = {
  s_intersects: 'ST_Intersects',
  s_within: 'ST_Within',
  s_contains: 'ST_Contains',
  s_touches: 'ST_Touches',
  s_crosses: 'ST_Crosses',
  s_overlaps: 'ST_Overlaps',
  s_equals: 'ST_Equals',
  s_disjoint: 'ST_Disjoint',
}

class JsonParser {
  private params: unknown[] = []
  private paramIndex: number
  private geometryColumn: string
  private srid: number
  private allowedColumns: Set<string>

  constructor(options: CqlParseOptions) {
    this.paramIndex = options.startParamIndex
    this.geometryColumn = options.geometryColumn
    this.srid = options.srid
    this.allowedColumns = options.allowedColumns
  }

  parse(expr: CqlJsonExpr): CqlResult {
    const sql = this.evaluate(expr)
    return { sql, params: this.params }
  }

  private evaluate(expr: CqlJsonExpr): string {
    if (typeof expr !== 'object' || expr === null) {
      throw new Error(`Invalid CQL2 JSON expression: ${JSON.stringify(expr)}`)
    }

    if (!('op' in expr) || !('args' in expr)) {
      throw new Error(`Invalid CQL2 JSON expression: missing "op" or "args"`)
    }

    const op = expr.op.toLowerCase()
    const args = expr.args

    // Logic operators
    if (op === 'and' || op === 'or') {
      return this.evaluateLogic(op, args)
    }
    if (op === 'not') {
      return this.evaluateNot(args)
    }

    // Comparison operators
    if (COMPARISON_OPS.has(op)) {
      return this.evaluateComparison(op, args)
    }

    // isNull
    if (op === 'isnull') {
      return this.evaluateIsNull(args)
    }

    // like
    if (op === 'like') {
      return this.evaluateLike(args)
    }

    // in
    if (op === 'in') {
      return this.evaluateIn(args)
    }

    // between
    if (op === 'between') {
      return this.evaluateBetween(args)
    }

    // Spatial operators
    if (SPATIAL_OPS[op]) {
      return this.evaluateSpatial(op, args)
    }

    // Temporal operators
    if (TEMPORAL_INSTANT_OPS.has(op) || TEMPORAL_INTERVAL_OPS.has(op)) {
      return this.evaluateTemporal(op, args)
    }

    throw new Error(`Unsupported CQL2 JSON operator: "${expr.op}"`)
  }

  private evaluateLogic(op: string, args: unknown[]): string {
    if (args.length < 2) {
      throw new Error(`"${op}" requires at least 2 arguments`)
    }
    const parts = args.map((a) => this.evaluate(a as CqlJsonExpr))
    return `(${parts.join(` ${op.toUpperCase()} `)})`
  }

  private evaluateNot(args: unknown[]): string {
    if (args.length !== 1) {
      throw new Error('"not" requires exactly 1 argument')
    }
    const inner = this.evaluate(args[0] as CqlJsonExpr)
    return `(NOT ${inner})`
  }

  private evaluateComparison(op: string, args: unknown[]): string {
    if (args.length !== 2) {
      throw new Error(`"${op}" requires exactly 2 arguments`)
    }
    const column = this.resolveProperty(args[0])
    const value = this.resolveLiteral(args[1])
    this.params.push(value)
    return `${column} ${op} $${this.paramIndex++}`
  }

  private evaluateIsNull(args: unknown[]): string {
    if (args.length !== 1) {
      throw new Error('"isNull" requires exactly 1 argument')
    }
    const column = this.resolveProperty(args[0])
    return `${column} IS NULL`
  }

  private evaluateLike(args: unknown[]): string {
    if (args.length !== 2) {
      throw new Error('"like" requires exactly 2 arguments')
    }

    // Check for casei wrapping (case-insensitive)
    const isCaseInsensitive = this.isCasei(args[0]) && this.isCasei(args[1])

    const column = isCaseInsensitive
      ? this.resolveProperty((args[0] as { args: unknown[] }).args[0])
      : this.resolveProperty(args[0])

    const pattern = isCaseInsensitive
      ? this.resolveLiteral((args[1] as { args: unknown[] }).args[0])
      : this.resolveLiteral(args[1])

    this.params.push(pattern)
    const sqlOp = isCaseInsensitive ? 'ILIKE' : 'LIKE'
    return `${column} ${sqlOp} $${this.paramIndex++}`
  }

  private evaluateIn(args: unknown[]): string {
    if (args.length !== 2) {
      throw new Error('"in" requires exactly 2 arguments')
    }
    const column = this.resolveProperty(args[0])
    const values = args[1]
    if (!Array.isArray(values)) {
      throw new Error('"in" second argument must be an array')
    }
    const placeholders: string[] = []
    for (const v of values) {
      const literal = this.resolveLiteral(v)
      this.params.push(literal)
      placeholders.push(`$${this.paramIndex++}`)
    }
    return `${column} IN (${placeholders.join(', ')})`
  }

  private evaluateBetween(args: unknown[]): string {
    if (args.length !== 3) {
      throw new Error('"between" requires exactly 3 arguments')
    }
    const column = this.resolveProperty(args[0])
    const low = this.resolveLiteral(args[1])
    const high = this.resolveLiteral(args[2])
    this.params.push(low)
    const lowParam = `$${this.paramIndex++}`
    this.params.push(high)
    const highParam = `$${this.paramIndex++}`
    return `${column} BETWEEN ${lowParam} AND ${highParam}`
  }

  private evaluateSpatial(op: string, args: unknown[]): string {
    if (args.length !== 2) {
      throw new Error(`"${op}" requires exactly 2 arguments`)
    }
    const pgFunc = SPATIAL_OPS[op]
    const propArg = args[0]
    if (!this.isProperty(propArg)) {
      throw new Error('First argument of spatial function must be a property reference')
    }

    const geomArg = args[1]
    if (typeof geomArg !== 'object' || geomArg === null) {
      throw new Error('Second argument of spatial function must be a GeoJSON geometry')
    }

    // Support both GeoJSON geometry and bbox
    const geojsonObj = geomArg as Record<string, unknown>
    let geomJson: string
    if ('bbox' in geojsonObj) {
      // Convert bbox to polygon GeoJSON
      const bbox = geojsonObj.bbox as number[]
      if (bbox.length < 4) throw new Error('bbox must have at least 4 values')
      const [minx, miny, maxx, maxy] = bbox
      geomJson = JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [minx, miny],
            [maxx, miny],
            [maxx, maxy],
            [minx, maxy],
            [minx, miny],
          ],
        ],
      })
    } else {
      geomJson = JSON.stringify(geomArg)
    }

    this.params.push(geomJson)
    const geomParam = `ST_Transform(ST_GeomFromGeoJSON($${this.paramIndex++}), ${this.srid})`
    return `${pgFunc}(${this.geometryColumn}, ${geomParam})`
  }

  private evaluateTemporal(op: string, args: unknown[]): string {
    if (args.length !== 2) {
      throw new Error(`"${op}" requires exactly 2 arguments`)
    }
    const column = this.resolveProperty(args[0])
    const temporal = args[1]

    if (typeof temporal !== 'object' || temporal === null) {
      throw new Error(`Second argument of "${op}" must be a temporal literal`)
    }

    const obj = temporal as Record<string, unknown>

    // Instant operators (timestamp or date)
    if (TEMPORAL_INSTANT_OPS.has(op)) {
      const value = this.resolveTemporalInstant(obj)
      this.params.push(value)
      if (op === 't_before') return `${column} < $${this.paramIndex++}`
      if (op === 't_after') return `${column} > $${this.paramIndex++}`
      // t_equals
      return `${column} = $${this.paramIndex++}`
    }

    // Interval operators
    if (!('interval' in obj)) {
      // Allow instant args for t_during/t_intersects — treat as point interval
      const value = this.resolveTemporalInstant(obj)
      this.params.push(value)
      if (op === 't_disjoint') return `${column} <> $${this.paramIndex++}`
      // t_during, t_intersects with instant → equals
      return `${column} = $${this.paramIndex++}`
    }

    const interval = obj.interval as string[]
    if (!Array.isArray(interval) || interval.length !== 2) {
      throw new Error('interval must be an array of 2 values')
    }

    const [start, end] = interval

    if (op === 't_during' || op === 't_intersects') {
      if (start === '..') {
        this.params.push(end)
        return `${column} <= $${this.paramIndex++}`
      }
      if (end === '..') {
        this.params.push(start)
        return `${column} >= $${this.paramIndex++}`
      }
      this.params.push(start)
      const startParam = `$${this.paramIndex++}`
      this.params.push(end)
      const endParam = `$${this.paramIndex++}`
      return `${column} BETWEEN ${startParam} AND ${endParam}`
    }

    // t_disjoint
    if (start === '..') {
      this.params.push(end)
      return `${column} > $${this.paramIndex++}`
    }
    if (end === '..') {
      this.params.push(start)
      return `${column} < $${this.paramIndex++}`
    }
    this.params.push(start)
    const startParam = `$${this.paramIndex++}`
    this.params.push(end)
    const endParam = `$${this.paramIndex++}`
    return `(${column} < ${startParam} OR ${column} > ${endParam})`
  }

  private resolveTemporalInstant(obj: Record<string, unknown>): string {
    if ('timestamp' in obj) return obj.timestamp as string
    if ('date' in obj) return obj.date as string
    throw new Error('Expected a temporal literal (timestamp, date, or interval)')
  }

  private resolveProperty(arg: unknown): string {
    if (!this.isProperty(arg)) {
      throw new Error(`Expected property reference, got: ${JSON.stringify(arg)}`)
    }
    const name = (arg as { property: string }).property
    const lower = name.toLowerCase()
    if (!this.allowedColumns.has(lower)) {
      throw new Error(`Unknown property: '${name}'`)
    }
    return lower
  }

  private resolveLiteral(arg: unknown): unknown {
    if (typeof arg === 'string') return arg
    if (typeof arg === 'number') return arg
    if (typeof arg === 'boolean') return arg
    if (typeof arg === 'object' && arg !== null) {
      if ('date' in arg) return (arg as { date: string }).date
      if ('timestamp' in arg) return (arg as { timestamp: string }).timestamp
    }
    throw new Error(`Unsupported literal value: ${JSON.stringify(arg)}`)
  }

  private isProperty(arg: unknown): boolean {
    return typeof arg === 'object' && arg !== null && 'property' in arg
  }

  private isCasei(arg: unknown): boolean {
    return (
      typeof arg === 'object' &&
      arg !== null &&
      'op' in arg &&
      (arg as { op: string }).op.toLowerCase() === 'casei' &&
      'args' in arg
    )
  }
}

export function parseCql2Json(expression: unknown, options: CqlParseOptions): CqlResult {
  if (typeof expression !== 'object' || expression === null) {
    return { sql: '', params: [] }
  }
  const parser = new JsonParser(options)
  return parser.parse(expression as CqlJsonExpr)
}

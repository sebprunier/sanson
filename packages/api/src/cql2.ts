/**
 * CQL2 Text parser — converts a CQL2 Text expression to a SQL WHERE clause.
 *
 * Supported V1 subset:
 * - Comparison: =, <>, <, <=, >, >=
 * - Logic: AND, OR, NOT
 * - Text: LIKE, ILIKE
 * - Null: IS NULL, IS NOT NULL
 * - List: IN ('val1', 'val2', ...)
 * - Spatial: S_INTERSECTS, S_WITHIN, S_CONTAINS
 */

export interface CqlResult {
  sql: string
  params: unknown[]
}

type Token =
  | { type: 'identifier'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'keyword'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

const KEYWORDS = new Set([
  'AND',
  'OR',
  'NOT',
  'IS',
  'NULL',
  'IN',
  'LIKE',
  'ILIKE',
  'TRUE',
  'FALSE',
  'S_INTERSECTS',
  'S_WITHIN',
  'S_CONTAINS',
])

const OPERATORS = ['<>', '<=', '>=', '=', '<', '>']

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++
      continue
    }

    // String literal
    if (input[i] === "'") {
      i++
      let str = ''
      while (i < input.length) {
        if (input[i] === "'" && input[i + 1] === "'") {
          str += "'"
          i += 2
        } else if (input[i] === "'") {
          i++
          break
        } else {
          str += input[i]
          i++
        }
      }
      tokens.push({ type: 'string', value: str })
      continue
    }

    // Parentheses
    if (input[i] === '(') {
      tokens.push({ type: 'lparen' })
      i++
      continue
    }
    if (input[i] === ')') {
      tokens.push({ type: 'rparen' })
      i++
      continue
    }
    if (input[i] === ',') {
      tokens.push({ type: 'comma' })
      i++
      continue
    }

    // Operators (check multi-char first)
    const remaining = input.slice(i)
    const matchedOp = OPERATORS.find((op) => remaining.startsWith(op))
    if (matchedOp) {
      tokens.push({ type: 'operator', value: matchedOp })
      i += matchedOp.length
      continue
    }

    // Number
    if (
      /[0-9]/.test(input[i]) ||
      (input[i] === '-' && i + 1 < input.length && /[0-9]/.test(input[i + 1]))
    ) {
      let num = ''
      if (input[i] === '-') {
        num += '-'
        i++
      }
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i]
        i++
      }
      tokens.push({ type: 'number', value: parseFloat(num) })
      continue
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(input[i])) {
      let word = ''
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        word += input[i]
        i++
      }
      const upper = word.toUpperCase()
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: upper })
      } else {
        tokens.push({ type: 'identifier', value: word })
      }
      continue
    }

    throw new Error(`Unexpected character: '${input[i]}' at position ${i}`)
  }

  return tokens
}

class Parser {
  private tokens: Token[]
  private pos = 0
  private params: unknown[] = []
  private paramIndex: number
  private geometryColumn: string
  private srid: number
  private allowedColumns: Set<string>

  constructor(
    tokens: Token[],
    startParamIndex: number,
    geometryColumn: string,
    srid: number,
    allowedColumns: Set<string>,
  ) {
    this.tokens = tokens
    this.paramIndex = startParamIndex
    this.geometryColumn = geometryColumn
    this.srid = srid
    this.allowedColumns = allowedColumns
  }

  parse(): CqlResult {
    const sql = this.parseOr()
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token at position ${this.pos}`)
    }
    return { sql, params: this.params }
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private advance(): Token {
    return this.tokens[this.pos++]
  }

  private expect(type: string, value?: string): Token {
    const token = this.advance()
    if (
      !token ||
      token.type !== type ||
      (value !== undefined && 'value' in token && token.value !== value)
    ) {
      throw new Error(
        `Expected ${type}${value ? ` '${value}'` : ''}, got ${token ? JSON.stringify(token) : 'end of input'}`,
      )
    }
    return token
  }

  private parseOr(): string {
    let left = this.parseAnd()
    while (this.peek()?.type === 'keyword' && (this.peek() as { value: string }).value === 'OR') {
      this.advance()
      const right = this.parseAnd()
      left = `(${left} OR ${right})`
    }
    return left
  }

  private parseAnd(): string {
    let left = this.parseNot()
    while (this.peek()?.type === 'keyword' && (this.peek() as { value: string }).value === 'AND') {
      this.advance()
      const right = this.parseNot()
      left = `(${left} AND ${right})`
    }
    return left
  }

  private parseNot(): string {
    if (this.peek()?.type === 'keyword' && (this.peek() as { value: string }).value === 'NOT') {
      this.advance()
      const expr = this.parsePrimary()
      return `(NOT ${expr})`
    }
    return this.parsePrimary()
  }

  private parsePrimary(): string {
    const token = this.peek()

    // Parenthesized expression
    if (token?.type === 'lparen') {
      this.advance()
      const expr = this.parseOr()
      this.expect('rparen')
      return `(${expr})`
    }

    // Spatial functions: S_INTERSECTS, S_WITHIN, S_CONTAINS
    if (
      token?.type === 'keyword' &&
      ['S_INTERSECTS', 'S_WITHIN', 'S_CONTAINS'].includes((token as { value: string }).value)
    ) {
      return this.parseSpatialFunction()
    }

    // Identifier-based expressions (comparison, IS NULL, IN, LIKE)
    if (token?.type === 'identifier') {
      return this.parseComparison()
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`)
  }

  private parseComparison(): string {
    const idToken = this.advance() as { type: 'identifier'; value: string }
    const column = this.validateColumn(idToken.value)
    const next = this.peek()

    // IS NULL / IS NOT NULL
    if (next?.type === 'keyword' && (next as { value: string }).value === 'IS') {
      this.advance()
      const notOrNull = this.peek()
      if (notOrNull?.type === 'keyword' && (notOrNull as { value: string }).value === 'NOT') {
        this.advance()
        this.expect('keyword', 'NULL')
        return `${column} IS NOT NULL`
      }
      this.expect('keyword', 'NULL')
      return `${column} IS NULL`
    }

    // IN (...)
    if (next?.type === 'keyword' && (next as { value: string }).value === 'IN') {
      this.advance()
      this.expect('lparen')
      const values: string[] = []
      while (true) {
        const val = this.parseValue()
        values.push(`$${this.paramIndex++}`)
        this.params.push(val)
        if (this.peek()?.type === 'comma') {
          this.advance()
        } else {
          break
        }
      }
      this.expect('rparen')
      return `${column} IN (${values.join(', ')})`
    }

    // LIKE / ILIKE
    if (next?.type === 'keyword' && ['LIKE', 'ILIKE'].includes((next as { value: string }).value)) {
      const op = (this.advance() as { value: string }).value
      const val = this.parseValue()
      this.params.push(val)
      return `${column} ${op} $${this.paramIndex++}`
    }

    // Comparison operators
    if (next?.type === 'operator') {
      const op = (this.advance() as { value: string }).value
      const val = this.parseValue()
      this.params.push(val)
      return `${column} ${op} $${this.paramIndex++}`
    }

    throw new Error(`Expected operator after '${idToken.value}'`)
  }

  private parseValue(): unknown {
    const token = this.advance()
    if (token.type === 'string') return token.value
    if (token.type === 'number') return token.value
    if (token.type === 'keyword') {
      if (token.value === 'TRUE') return true
      if (token.value === 'FALSE') return false
    }
    throw new Error(`Expected value, got ${JSON.stringify(token)}`)
  }

  private parseSpatialFunction(): string {
    const funcToken = this.advance() as { type: 'keyword'; value: string }
    const pgFunc = spatialFuncMap[funcToken.value]
    if (!pgFunc) throw new Error(`Unknown spatial function: ${funcToken.value}`)

    this.expect('lparen')

    // First arg should be the geometry column reference or an identifier
    const firstArg = this.advance()
    if (firstArg.type !== 'identifier') {
      throw new Error('First argument of spatial function must be a property name')
    }

    this.expect('comma')

    // Second arg: geometry literal (WKT string or GeoJSON-like)
    const geomValue = this.parseValue()
    if (typeof geomValue !== 'string') {
      throw new Error('Geometry argument must be a WKT string')
    }

    this.expect('rparen')

    // Convert WKT to geometry, transform to layer SRID for index usage
    this.params.push(geomValue)
    const geomParam = `ST_Transform(ST_GeomFromText($${this.paramIndex++}, 4326), ${this.srid})`
    return `${pgFunc}(${this.geometryColumn}, ${geomParam})`
  }

  private validateColumn(name: string): string {
    const lower = name.toLowerCase()
    if (!this.allowedColumns.has(lower)) {
      throw new Error(`Unknown property: '${name}'`)
    }
    return lower
  }
}

const spatialFuncMap: Record<string, string> = {
  S_INTERSECTS: 'ST_Intersects',
  S_WITHIN: 'ST_Within',
  S_CONTAINS: 'ST_Contains',
}

export interface CqlParseOptions {
  startParamIndex: number
  geometryColumn: string
  srid: number
  allowedColumns: Set<string>
}

export function parseCql2Text(expression: string, options: CqlParseOptions): CqlResult {
  const tokens = tokenize(expression)
  if (tokens.length === 0) {
    return { sql: '', params: [] }
  }
  const parser = new Parser(
    tokens,
    options.startParamIndex,
    options.geometryColumn,
    options.srid,
    options.allowedColumns,
  )
  return parser.parse()
}

export interface CqlResult {
  sql: string
  params: unknown[]
}

export interface CqlParseOptions {
  startParamIndex: number
  geometryColumn: string
  srid: number
  allowedColumns: Set<string>
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { buildApp } from '../src/app'

// GET /conformance does not use the db — dummy pool for the onClose hook
const db = { end: async () => {} } as unknown as Pool

describe('GET /conformance', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = buildApp(db)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/conformance' })
    expect(response.statusCode).toBe(200)
  })

  it('returns a conformsTo array', async () => {
    const response = await app.inject({ method: 'GET', url: '/conformance' })
    const body = response.json()
    expect(body.conformsTo).toBeInstanceOf(Array)
    expect(body.conformsTo.length).toBeGreaterThan(0)
  })

  it('includes OGC Core conformance class', async () => {
    const response = await app.inject({ method: 'GET', url: '/conformance' })
    const body = response.json()
    expect(body.conformsTo).toContain('http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core')
  })

  it('includes all V1 conformance classes', async () => {
    const response = await app.inject({ method: 'GET', url: '/conformance' })
    const body = response.json()

    const expected = [
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core',
      'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson',
      'http://www.opengis.net/spec/ogcapi-common/1.0/req/oas30',
      'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter',
      'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/features-filter',
      'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/queryables',
      'http://www.opengis.net/spec/cql2/1.0/req/cql2-text',
      'http://www.opengis.net/spec/cql2/1.0/req/basic-cql2',
      'http://www.opengis.net/spec/cql2/1.0/req/basic-spatial-operators',
      'http://www.opengis.net/spec/cql2/1.0/req/advanced-comparison-operators',
    ]

    for (const uri of expected) {
      expect(body.conformsTo).toContain(uri)
    }
  })
})

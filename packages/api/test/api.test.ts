import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { buildApp } from '../src/app'

// GET /api does not use the db — dummy pool for the onClose hook
const db = { end: async () => {} } as unknown as Pool

describe('GET /api', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = buildApp(db)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/api' })
    expect(response.statusCode).toBe(200)
  })

  it('returns a valid OpenAPI 3.0 document', async () => {
    const response = await app.inject({ method: 'GET', url: '/api' })
    const body = response.json()

    expect(body.openapi).toMatch(/^3\./)
    expect(body.info.title).toBe('Sanson')
    expect(body.info.version).toBe('0.1.0')
  })

  it('documents the OGC endpoints', async () => {
    const response = await app.inject({ method: 'GET', url: '/api' })
    const body = response.json()
    const paths = Object.keys(body.paths)

    expect(paths).toContain('/')
    expect(paths).toContain('/conformance')
    expect(paths).toContain('/health')
  })
})

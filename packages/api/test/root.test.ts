import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { buildApp } from '../src/app'

// GET / does not use the db — we pass a pool with a no-op end() for the onClose hook
const db = { end: async () => {} } as unknown as Pool

describe('GET /', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = buildApp(db)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(200)
  })

  it('returns the OGC landing page', async () => {
    const response = await app.inject({ method: 'GET', url: '/' })
    const body = response.json()

    expect(body.title).toBe('Sanson')
    expect(body.description).toBeDefined()
    expect(body.links).toHaveLength(5)
  })

  it('includes required OGC links', async () => {
    const response = await app.inject({ method: 'GET', url: '/' })
    const body = response.json()
    const rels = body.links.map((l: { rel: string }) => l.rel)

    expect(rels).toContain('self')
    expect(rels).toContain('conformance')
    expect(rels).toContain('data')
    expect(rels).toContain('service-desc')
    expect(rels).toContain('tiling-schemes')
  })
})

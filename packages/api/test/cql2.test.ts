import { describe, it, expect } from 'vitest'
import { parseCql2Text } from '../src/cql2'

const defaultOptions = {
  startParamIndex: 1,
  geometryColumn: 'geom',
  srid: 4326,
  allowedColumns: new Set(['name', 'population', 'status', 'active', 'category', 'geom']),
}

function parse(expr: string, opts = defaultOptions) {
  return parseCql2Text(expr, opts)
}

describe('CQL2 Text parser', () => {
  describe('comparison operators', () => {
    it('equals string', () => {
      const r = parse("name='Paris'")
      expect(r.sql).toBe('name = $1')
      expect(r.params).toEqual(['Paris'])
    })

    it('equals number', () => {
      const r = parse('population=1000')
      expect(r.sql).toBe('population = $1')
      expect(r.params).toEqual([1000])
    })

    it('not equals', () => {
      const r = parse("status<>'closed'")
      expect(r.sql).toBe('status <> $1')
      expect(r.params).toEqual(['closed'])
    })

    it('less than', () => {
      const r = parse('population<500')
      expect(r.sql).toBe('population < $1')
      expect(r.params).toEqual([500])
    })

    it('greater than or equal', () => {
      const r = parse('population>=1000')
      expect(r.sql).toBe('population >= $1')
      expect(r.params).toEqual([1000])
    })
  })

  describe('logic operators', () => {
    it('AND', () => {
      const r = parse("name='Paris' AND population>100")
      expect(r.sql).toBe('(name = $1 AND population > $2)')
      expect(r.params).toEqual(['Paris', 100])
    })

    it('OR', () => {
      const r = parse("name='Paris' OR name='Lyon'")
      expect(r.sql).toBe('(name = $1 OR name = $2)')
      expect(r.params).toEqual(['Paris', 'Lyon'])
    })

    it('NOT', () => {
      const r = parse("NOT name='Paris'")
      expect(r.sql).toBe('(NOT name = $1)')
      expect(r.params).toEqual(['Paris'])
    })

    it('precedence: AND before OR', () => {
      const r = parse("name='A' OR name='B' AND population>100")
      expect(r.sql).toBe('(name = $1 OR (name = $2 AND population > $3))')
    })

    it('parenthesized expression', () => {
      const r = parse("(name='A' OR name='B') AND population>100")
      expect(r.sql).toBe('(((name = $1 OR name = $2)) AND population > $3)')
    })
  })

  describe('text operators', () => {
    it('LIKE', () => {
      const r = parse("name LIKE 'Par%'")
      expect(r.sql).toBe('name LIKE $1')
      expect(r.params).toEqual(['Par%'])
    })

    it('ILIKE', () => {
      const r = parse("name ILIKE '%paris%'")
      expect(r.sql).toBe('name ILIKE $1')
      expect(r.params).toEqual(['%paris%'])
    })
  })

  describe('null operators', () => {
    it('IS NULL', () => {
      const r = parse('status IS NULL')
      expect(r.sql).toBe('status IS NULL')
      expect(r.params).toEqual([])
    })

    it('IS NOT NULL', () => {
      const r = parse('status IS NOT NULL')
      expect(r.sql).toBe('status IS NOT NULL')
      expect(r.params).toEqual([])
    })
  })

  describe('IN operator', () => {
    it('IN with strings', () => {
      const r = parse("status IN ('open','closed')")
      expect(r.sql).toBe('status IN ($1, $2)')
      expect(r.params).toEqual(['open', 'closed'])
    })

    it('IN with numbers', () => {
      const r = parse('population IN (100,200,300)')
      expect(r.sql).toBe('population IN ($1, $2, $3)')
      expect(r.params).toEqual([100, 200, 300])
    })
  })

  describe('spatial operators', () => {
    it('S_INTERSECTS', () => {
      const r = parse("S_INTERSECTS(geom,'POLYGON((0 0,1 0,1 1,0 1,0 0))')")
      expect(r.sql).toBe('ST_Intersects(geom, ST_Transform(ST_GeomFromText($1, 4326), 4326))')
      expect(r.params).toEqual(['POLYGON((0 0,1 0,1 1,0 1,0 0))'])
    })

    it('S_WITHIN', () => {
      const r = parse("S_WITHIN(geom,'POLYGON((0 0,1 0,1 1,0 1,0 0))')")
      expect(r.sql).toBe('ST_Within(geom, ST_Transform(ST_GeomFromText($1, 4326), 4326))')
    })

    it('S_CONTAINS with different SRID', () => {
      const r = parse("S_CONTAINS(geom,'POLYGON((0 0,1 0,1 1,0 1,0 0))')", {
        ...defaultOptions,
        srid: 2154,
      })
      expect(r.sql).toBe('ST_Contains(geom, ST_Transform(ST_GeomFromText($1, 4326), 2154))')
    })
  })

  describe('paramIndex offset', () => {
    it('starts from given index', () => {
      const r = parse("name='test'", { ...defaultOptions, startParamIndex: 5 })
      expect(r.sql).toBe('name = $5')
      expect(r.params).toEqual(['test'])
    })
  })

  describe('error handling', () => {
    it('rejects unknown column', () => {
      expect(() => parse("unknown_col='x'")).toThrow("Unknown property: 'unknown_col'")
    })

    it('rejects empty expression', () => {
      const r = parse('')
      expect(r.sql).toBe('')
      expect(r.params).toEqual([])
    })

    it('rejects invalid syntax', () => {
      expect(() => parse('= bad')).toThrow()
    })
  })

  describe('escaped strings', () => {
    it('handles escaped single quotes', () => {
      const r = parse("name='it''s'")
      expect(r.params).toEqual(["it's"])
    })
  })

  describe('complex expressions', () => {
    it('combined filter', () => {
      const r = parse("name='A' AND population>=100 AND status IS NOT NULL")
      expect(r.sql).toBe('((name = $1 AND population >= $2) AND status IS NOT NULL)')
      expect(r.params).toEqual(['A', 100])
    })
  })
})

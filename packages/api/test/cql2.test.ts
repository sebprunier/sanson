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

  describe('BETWEEN operator', () => {
    it('BETWEEN', () => {
      const r = parse('population BETWEEN 100 AND 1000')
      expect(r.sql).toBe('population BETWEEN $1 AND $2')
      expect(r.params).toEqual([100, 1000])
    })

    it('NOT BETWEEN', () => {
      const r = parse('population NOT BETWEEN 100 AND 1000')
      expect(r.sql).toBe('population NOT BETWEEN $1 AND $2')
      expect(r.params).toEqual([100, 1000])
    })

    it('BETWEEN with strings', () => {
      const r = parse("name BETWEEN 'A' AND 'M'")
      expect(r.sql).toBe('name BETWEEN $1 AND $2')
      expect(r.params).toEqual(['A', 'M'])
    })
  })

  describe('negated operators', () => {
    it('NOT IN', () => {
      const r = parse("status NOT IN ('closed','archived')")
      expect(r.sql).toBe('status NOT IN ($1, $2)')
      expect(r.params).toEqual(['closed', 'archived'])
    })

    it('NOT LIKE', () => {
      const r = parse("name NOT LIKE 'test%'")
      expect(r.sql).toBe('name NOT LIKE $1')
      expect(r.params).toEqual(['test%'])
    })

    it('NOT ILIKE', () => {
      const r = parse("name NOT ILIKE '%paris%'")
      expect(r.sql).toBe('name NOT ILIKE $1')
      expect(r.params).toEqual(['%paris%'])
    })
  })

  describe('additional spatial operators', () => {
    it('S_TOUCHES', () => {
      const r = parse("S_TOUCHES(geom,'POLYGON((0 0,1 0,1 1,0 1,0 0))')")
      expect(r.sql).toBe('ST_Touches(geom, ST_Transform(ST_GeomFromText($1, 4326), 4326))')
    })

    it('S_CROSSES', () => {
      const r = parse("S_CROSSES(geom,'LINESTRING(0 0,1 1)')")
      expect(r.sql).toBe('ST_Crosses(geom, ST_Transform(ST_GeomFromText($1, 4326), 4326))')
    })

    it('S_OVERLAPS', () => {
      const r = parse("S_OVERLAPS(geom,'POLYGON((0 0,1 0,1 1,0 1,0 0))')")
      expect(r.sql).toBe('ST_Overlaps(geom, ST_Transform(ST_GeomFromText($1, 4326), 4326))')
    })

    it('S_EQUALS', () => {
      const r = parse("S_EQUALS(geom,'POINT(2.35 48.85)')")
      expect(r.sql).toBe('ST_Equals(geom, ST_Transform(ST_GeomFromText($1, 4326), 4326))')
    })

    it('S_DISJOINT', () => {
      const r = parse("S_DISJOINT(geom,'POLYGON((0 0,1 0,1 1,0 1,0 0))')")
      expect(r.sql).toBe('ST_Disjoint(geom, ST_Transform(ST_GeomFromText($1, 4326), 4326))')
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

  describe('temporal operators', () => {
    it('T_BEFORE with TIMESTAMP', () => {
      const r = parse("T_BEFORE(status,TIMESTAMP('2024-01-01T00:00:00Z'))")
      expect(r.sql).toBe('status < $1')
      expect(r.params).toEqual(['2024-01-01T00:00:00Z'])
    })

    it('T_AFTER with DATE', () => {
      const r = parse("T_AFTER(status,DATE('2024-06-15'))")
      expect(r.sql).toBe('status > $1')
      expect(r.params).toEqual(['2024-06-15'])
    })

    it('T_EQUALS with TIMESTAMP', () => {
      const r = parse("T_EQUALS(status,TIMESTAMP('2024-01-01T12:00:00Z'))")
      expect(r.sql).toBe('status = $1')
      expect(r.params).toEqual(['2024-01-01T12:00:00Z'])
    })

    it('T_DURING with INTERVAL', () => {
      const r = parse("T_DURING(status,INTERVAL('2024-01-01','2024-12-31'))")
      expect(r.sql).toBe('status BETWEEN $1 AND $2')
      expect(r.params).toEqual(['2024-01-01', '2024-12-31'])
    })

    it('T_INTERSECTS with INTERVAL', () => {
      const r = parse("T_INTERSECTS(status,INTERVAL('2024-01-01','2024-12-31'))")
      expect(r.sql).toBe('status BETWEEN $1 AND $2')
      expect(r.params).toEqual(['2024-01-01', '2024-12-31'])
    })

    it('T_DURING with open-ended start', () => {
      const r = parse("T_DURING(status,INTERVAL('..','2024-12-31'))")
      expect(r.sql).toBe('status <= $1')
      expect(r.params).toEqual(['2024-12-31'])
    })

    it('T_DURING with open-ended end', () => {
      const r = parse("T_DURING(status,INTERVAL('2024-01-01','..'))")
      expect(r.sql).toBe('status >= $1')
      expect(r.params).toEqual(['2024-01-01'])
    })

    it('T_DISJOINT with INTERVAL', () => {
      const r = parse("T_DISJOINT(status,INTERVAL('2024-01-01','2024-12-31'))")
      expect(r.sql).toBe('(status < $1 OR status > $2)')
      expect(r.params).toEqual(['2024-01-01', '2024-12-31'])
    })

    it('T_DISJOINT with open-ended start', () => {
      const r = parse("T_DISJOINT(status,INTERVAL('..','2024-12-31'))")
      expect(r.sql).toBe('status > $1')
      expect(r.params).toEqual(['2024-12-31'])
    })

    it('T_DISJOINT with open-ended end', () => {
      const r = parse("T_DISJOINT(status,INTERVAL('2024-01-01','..'))")
      expect(r.sql).toBe('status < $1')
      expect(r.params).toEqual(['2024-01-01'])
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

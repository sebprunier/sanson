import { describe, it, expect } from 'vitest'
import { parseCql2Json } from '../src/cql2-json'

const defaultOptions = {
  startParamIndex: 1,
  geometryColumn: 'geom',
  srid: 4326,
  allowedColumns: new Set(['name', 'population', 'status', 'active', 'category', 'geom']),
}

function parse(expr: unknown, opts = defaultOptions) {
  return parseCql2Json(expr, opts)
}

describe('CQL2 JSON parser', () => {
  describe('comparison operators', () => {
    it('equals string', () => {
      const r = parse({ op: '=', args: [{ property: 'name' }, 'Paris'] })
      expect(r.sql).toBe('name = $1')
      expect(r.params).toEqual(['Paris'])
    })

    it('equals number', () => {
      const r = parse({ op: '=', args: [{ property: 'population' }, 1000] })
      expect(r.sql).toBe('population = $1')
      expect(r.params).toEqual([1000])
    })

    it('not equals', () => {
      const r = parse({ op: '<>', args: [{ property: 'status' }, 'closed'] })
      expect(r.sql).toBe('status <> $1')
      expect(r.params).toEqual(['closed'])
    })

    it('less than', () => {
      const r = parse({ op: '<', args: [{ property: 'population' }, 500] })
      expect(r.sql).toBe('population < $1')
      expect(r.params).toEqual([500])
    })

    it('greater than or equal', () => {
      const r = parse({ op: '>=', args: [{ property: 'population' }, 1000] })
      expect(r.sql).toBe('population >= $1')
      expect(r.params).toEqual([1000])
    })
  })

  describe('logic operators', () => {
    it('and', () => {
      const r = parse({
        op: 'and',
        args: [
          { op: '=', args: [{ property: 'name' }, 'Paris'] },
          { op: '>', args: [{ property: 'population' }, 100] },
        ],
      })
      expect(r.sql).toBe('(name = $1 AND population > $2)')
      expect(r.params).toEqual(['Paris', 100])
    })

    it('or', () => {
      const r = parse({
        op: 'or',
        args: [
          { op: '=', args: [{ property: 'name' }, 'Paris'] },
          { op: '=', args: [{ property: 'name' }, 'Lyon'] },
        ],
      })
      expect(r.sql).toBe('(name = $1 OR name = $2)')
      expect(r.params).toEqual(['Paris', 'Lyon'])
    })

    it('not', () => {
      const r = parse({
        op: 'not',
        args: [{ op: '=', args: [{ property: 'name' }, 'Paris'] }],
      })
      expect(r.sql).toBe('(NOT name = $1)')
      expect(r.params).toEqual(['Paris'])
    })

    it('and with 3+ args', () => {
      const r = parse({
        op: 'and',
        args: [
          { op: '=', args: [{ property: 'name' }, 'A'] },
          { op: '>', args: [{ property: 'population' }, 100] },
          { op: '<>', args: [{ property: 'status' }, 'closed'] },
        ],
      })
      expect(r.sql).toBe('(name = $1 AND population > $2 AND status <> $3)')
      expect(r.params).toEqual(['A', 100, 'closed'])
    })
  })

  describe('like operator', () => {
    it('LIKE (case-sensitive)', () => {
      const r = parse({ op: 'like', args: [{ property: 'name' }, 'Par%'] })
      expect(r.sql).toBe('name LIKE $1')
      expect(r.params).toEqual(['Par%'])
    })

    it('ILIKE via casei', () => {
      const r = parse({
        op: 'like',
        args: [
          { op: 'casei', args: [{ property: 'name' }] },
          { op: 'casei', args: ['%paris%'] },
        ],
      })
      expect(r.sql).toBe('name ILIKE $1')
      expect(r.params).toEqual(['%paris%'])
    })
  })

  describe('isNull operator', () => {
    it('IS NULL', () => {
      const r = parse({ op: 'isNull', args: [{ property: 'status' }] })
      expect(r.sql).toBe('status IS NULL')
      expect(r.params).toEqual([])
    })

    it('IS NOT NULL via not + isNull', () => {
      const r = parse({
        op: 'not',
        args: [{ op: 'isNull', args: [{ property: 'status' }] }],
      })
      expect(r.sql).toBe('(NOT status IS NULL)')
      expect(r.params).toEqual([])
    })
  })

  describe('in operator', () => {
    it('IN with strings', () => {
      const r = parse({
        op: 'in',
        args: [{ property: 'status' }, ['open', 'closed']],
      })
      expect(r.sql).toBe('status IN ($1, $2)')
      expect(r.params).toEqual(['open', 'closed'])
    })

    it('IN with numbers', () => {
      const r = parse({
        op: 'in',
        args: [{ property: 'population' }, [100, 200, 300]],
      })
      expect(r.sql).toBe('population IN ($1, $2, $3)')
      expect(r.params).toEqual([100, 200, 300])
    })

    it('NOT IN via not + in', () => {
      const r = parse({
        op: 'not',
        args: [
          {
            op: 'in',
            args: [{ property: 'status' }, ['closed', 'archived']],
          },
        ],
      })
      expect(r.sql).toBe('(NOT status IN ($1, $2))')
      expect(r.params).toEqual(['closed', 'archived'])
    })
  })

  describe('between operator', () => {
    it('BETWEEN numbers', () => {
      const r = parse({
        op: 'between',
        args: [{ property: 'population' }, 100, 1000],
      })
      expect(r.sql).toBe('population BETWEEN $1 AND $2')
      expect(r.params).toEqual([100, 1000])
    })

    it('BETWEEN strings', () => {
      const r = parse({
        op: 'between',
        args: [{ property: 'name' }, 'A', 'M'],
      })
      expect(r.sql).toBe('name BETWEEN $1 AND $2')
      expect(r.params).toEqual(['A', 'M'])
    })
  })

  describe('spatial operators', () => {
    it('s_intersects with GeoJSON Point', () => {
      const r = parse({
        op: 's_intersects',
        args: [{ property: 'geom' }, { type: 'Point', coordinates: [2.35, 48.85] }],
      })
      expect(r.sql).toBe('ST_Intersects(geom, ST_Transform(ST_GeomFromGeoJSON($1), 4326))')
      expect(r.params).toEqual([JSON.stringify({ type: 'Point', coordinates: [2.35, 48.85] })])
    })

    it('s_within with GeoJSON Polygon', () => {
      const polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      }
      const r = parse({
        op: 's_within',
        args: [{ property: 'geom' }, polygon],
      })
      expect(r.sql).toBe('ST_Within(geom, ST_Transform(ST_GeomFromGeoJSON($1), 4326))')
      expect(r.params).toEqual([JSON.stringify(polygon)])
    })

    it('s_contains with different SRID', () => {
      const r = parse(
        {
          op: 's_contains',
          args: [{ property: 'geom' }, { type: 'Point', coordinates: [2.35, 48.85] }],
        },
        { ...defaultOptions, srid: 2154 },
      )
      expect(r.sql).toBe('ST_Contains(geom, ST_Transform(ST_GeomFromGeoJSON($1), 2154))')
    })

    it('s_intersects with bbox', () => {
      const r = parse({
        op: 's_intersects',
        args: [{ property: 'geom' }, { bbox: [0, 0, 1, 1] }],
      })
      expect(r.sql).toBe('ST_Intersects(geom, ST_Transform(ST_GeomFromGeoJSON($1), 4326))')
      const geom = JSON.parse(r.params[0] as string)
      expect(geom.type).toBe('Polygon')
    })

    it('all spatial operators produce correct function names', () => {
      const ops = [
        ['s_intersects', 'ST_Intersects'],
        ['s_within', 'ST_Within'],
        ['s_contains', 'ST_Contains'],
        ['s_touches', 'ST_Touches'],
        ['s_crosses', 'ST_Crosses'],
        ['s_overlaps', 'ST_Overlaps'],
        ['s_equals', 'ST_Equals'],
        ['s_disjoint', 'ST_Disjoint'],
      ]
      for (const [cqlOp, pgFunc] of ops) {
        const r = parse({
          op: cqlOp,
          args: [{ property: 'geom' }, { type: 'Point', coordinates: [0, 0] }],
        })
        expect(r.sql).toContain(`${pgFunc}(`)
      }
    })
  })

  describe('paramIndex offset', () => {
    it('starts from given index', () => {
      const r = parse(
        { op: '=', args: [{ property: 'name' }, 'test'] },
        {
          ...defaultOptions,
          startParamIndex: 5,
        },
      )
      expect(r.sql).toBe('name = $5')
      expect(r.params).toEqual(['test'])
    })
  })

  describe('temporal operators', () => {
    it('t_before with timestamp', () => {
      const r = parse({
        op: 't_before',
        args: [{ property: 'status' }, { timestamp: '2024-01-01T00:00:00Z' }],
      })
      expect(r.sql).toBe('status < $1')
      expect(r.params).toEqual(['2024-01-01T00:00:00Z'])
    })

    it('t_after with date', () => {
      const r = parse({
        op: 't_after',
        args: [{ property: 'status' }, { date: '2024-06-15' }],
      })
      expect(r.sql).toBe('status > $1')
      expect(r.params).toEqual(['2024-06-15'])
    })

    it('t_equals with timestamp', () => {
      const r = parse({
        op: 't_equals',
        args: [{ property: 'status' }, { timestamp: '2024-01-01T12:00:00Z' }],
      })
      expect(r.sql).toBe('status = $1')
      expect(r.params).toEqual(['2024-01-01T12:00:00Z'])
    })

    it('t_during with interval', () => {
      const r = parse({
        op: 't_during',
        args: [{ property: 'status' }, { interval: ['2024-01-01', '2024-12-31'] }],
      })
      expect(r.sql).toBe('status BETWEEN $1 AND $2')
      expect(r.params).toEqual(['2024-01-01', '2024-12-31'])
    })

    it('t_intersects with interval', () => {
      const r = parse({
        op: 't_intersects',
        args: [{ property: 'status' }, { interval: ['2024-01-01', '2024-12-31'] }],
      })
      expect(r.sql).toBe('status BETWEEN $1 AND $2')
      expect(r.params).toEqual(['2024-01-01', '2024-12-31'])
    })

    it('t_during with open-ended start', () => {
      const r = parse({
        op: 't_during',
        args: [{ property: 'status' }, { interval: ['..', '2024-12-31'] }],
      })
      expect(r.sql).toBe('status <= $1')
      expect(r.params).toEqual(['2024-12-31'])
    })

    it('t_during with open-ended end', () => {
      const r = parse({
        op: 't_during',
        args: [{ property: 'status' }, { interval: ['2024-01-01', '..'] }],
      })
      expect(r.sql).toBe('status >= $1')
      expect(r.params).toEqual(['2024-01-01'])
    })

    it('t_disjoint with interval', () => {
      const r = parse({
        op: 't_disjoint',
        args: [{ property: 'status' }, { interval: ['2024-01-01', '2024-12-31'] }],
      })
      expect(r.sql).toBe('(status < $1 OR status > $2)')
      expect(r.params).toEqual(['2024-01-01', '2024-12-31'])
    })

    it('t_disjoint with open-ended start', () => {
      const r = parse({
        op: 't_disjoint',
        args: [{ property: 'status' }, { interval: ['..', '2024-12-31'] }],
      })
      expect(r.sql).toBe('status > $1')
      expect(r.params).toEqual(['2024-12-31'])
    })

    it('t_disjoint with open-ended end', () => {
      const r = parse({
        op: 't_disjoint',
        args: [{ property: 'status' }, { interval: ['2024-01-01', '..'] }],
      })
      expect(r.sql).toBe('status < $1')
      expect(r.params).toEqual(['2024-01-01'])
    })
  })

  describe('error handling', () => {
    it('rejects unknown column', () => {
      expect(() => parse({ op: '=', args: [{ property: 'unknown_col' }, 'x'] })).toThrow(
        "Unknown property: 'unknown_col'",
      )
    })

    it('rejects empty expression', () => {
      const r = parse(null)
      expect(r.sql).toBe('')
      expect(r.params).toEqual([])
    })

    it('rejects unsupported operator', () => {
      expect(() => parse({ op: 'foobar', args: [] })).toThrow('Unsupported CQL2 JSON operator')
    })

    it('rejects missing op/args', () => {
      expect(() => parse({ foo: 'bar' })).toThrow('missing "op" or "args"')
    })
  })

  describe('complex expressions', () => {
    it('combined filter', () => {
      const r = parse({
        op: 'and',
        args: [
          { op: '=', args: [{ property: 'name' }, 'A'] },
          { op: '>=', args: [{ property: 'population' }, 100] },
          { op: 'not', args: [{ op: 'isNull', args: [{ property: 'status' }] }] },
        ],
      })
      expect(r.sql).toBe('(name = $1 AND population >= $2 AND (NOT status IS NULL))')
      expect(r.params).toEqual(['A', 100])
    })

    it('nested or inside and', () => {
      const r = parse({
        op: 'and',
        args: [
          {
            op: 'or',
            args: [
              { op: '=', args: [{ property: 'name' }, 'A'] },
              { op: '=', args: [{ property: 'name' }, 'B'] },
            ],
          },
          { op: '>', args: [{ property: 'population' }, 100] },
        ],
      })
      expect(r.sql).toBe('((name = $1 OR name = $2) AND population > $3)')
      expect(r.params).toEqual(['A', 'B', 100])
    })
  })
})

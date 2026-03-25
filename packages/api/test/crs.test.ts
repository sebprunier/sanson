import { describe, it, expect } from 'vitest'
import { sridToUri, uriToSrid, buildSupportedCrs, resolveOutputSrid, CRS84_URI } from '@sanson/core'

describe('CRS utilities', () => {
  describe('sridToUri', () => {
    it('converts SRID to EPSG URI', () => {
      expect(sridToUri(4326)).toBe('http://www.opengis.net/def/crs/EPSG/0/4326')
      expect(sridToUri(3857)).toBe('http://www.opengis.net/def/crs/EPSG/0/3857')
      expect(sridToUri(2154)).toBe('http://www.opengis.net/def/crs/EPSG/0/2154')
    })
  })

  describe('uriToSrid', () => {
    it('parses CRS84 URI', () => {
      expect(uriToSrid(CRS84_URI)).toBe(4326)
    })

    it('parses EPSG URIs', () => {
      expect(uriToSrid('http://www.opengis.net/def/crs/EPSG/0/4326')).toBe(4326)
      expect(uriToSrid('http://www.opengis.net/def/crs/EPSG/0/3857')).toBe(3857)
      expect(uriToSrid('http://www.opengis.net/def/crs/EPSG/0/2154')).toBe(2154)
    })

    it('returns null for unknown URIs', () => {
      expect(uriToSrid('http://example.com/unknown')).toBeNull()
      expect(uriToSrid('http://www.opengis.net/def/crs/EPSG/0/abc')).toBeNull()
    })
  })

  describe('buildSupportedCrs', () => {
    it('includes CRS84 first plus base SRIDs', () => {
      const crs = buildSupportedCrs(4326)
      expect(crs[0]).toBe(CRS84_URI)
      expect(crs).toContain('http://www.opengis.net/def/crs/EPSG/0/4326')
      expect(crs).toContain('http://www.opengis.net/def/crs/EPSG/0/3857')
      expect(crs).toContain('http://www.opengis.net/def/crs/EPSG/0/2154')
    })

    it('adds native SRID if not in base set', () => {
      const crs = buildSupportedCrs(32631)
      expect(crs).toContain('http://www.opengis.net/def/crs/EPSG/0/32631')
    })

    it('does not duplicate native SRID if already in base set', () => {
      const crs = buildSupportedCrs(3857)
      const count = crs.filter((u) => u === 'http://www.opengis.net/def/crs/EPSG/0/3857').length
      expect(count).toBe(1)
    })
  })

  describe('resolveOutputSrid', () => {
    it('defaults to CRS84 / 4326 when undefined', () => {
      const r = resolveOutputSrid(undefined)
      expect(r.srid).toBe(4326)
      expect(r.crsUri).toBe(CRS84_URI)
    })

    it('defaults to CRS84 / 4326 when CRS84 URI', () => {
      const r = resolveOutputSrid(CRS84_URI)
      expect(r.srid).toBe(4326)
      expect(r.crsUri).toBe(CRS84_URI)
    })

    it('resolves EPSG URI', () => {
      const r = resolveOutputSrid('http://www.opengis.net/def/crs/EPSG/0/3857')
      expect(r.srid).toBe(3857)
      expect(r.crsUri).toBe('http://www.opengis.net/def/crs/EPSG/0/3857')
    })

    it('throws for unsupported URI', () => {
      expect(() => resolveOutputSrid('http://example.com/bad')).toThrow('Unsupported CRS')
    })
  })
})

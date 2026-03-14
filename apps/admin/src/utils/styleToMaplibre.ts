import type { StyleConfig } from '../services/api'

interface MaplibrePaint {
  fill?: Record<string, unknown>
  line?: Record<string, unknown>
  circle?: Record<string, unknown>
}

const DEFAULT_FILL_COLOR = '#1B4F72'
const DEFAULT_FILL_OPACITY = 0.3
const DEFAULT_STROKE_WIDTH = 1.5
const DEFAULT_CIRCLE_RADIUS = 6

export function styleToMaplibrePaint(
  style: StyleConfig | null,
  geometryType: string | null,
): MaplibrePaint {
  if (!style) return defaultPaint(geometryType)

  const geom = geometryType ?? ''

  if (style.type === 'single') {
    return singlePaint(style, geom)
  }
  if (style.type === 'categorized' && style.field && style.categories?.length) {
    return categorizedPaint(style, geom)
  }
  if (style.type === 'graduated' && style.field && style.classes?.length) {
    return graduatedPaint(style, geom)
  }

  return defaultPaint(geometryType)
}

function defaultPaint(geometryType: string | null): MaplibrePaint {
  const geom = geometryType ?? ''
  if (geom.includes('Polygon')) {
    return {
      fill: { 'fill-color': DEFAULT_FILL_COLOR, 'fill-opacity': DEFAULT_FILL_OPACITY },
      line: { 'line-color': DEFAULT_FILL_COLOR, 'line-width': DEFAULT_STROKE_WIDTH },
    }
  }
  if (geom.includes('Line')) {
    return { line: { 'line-color': DEFAULT_FILL_COLOR, 'line-width': 2 } }
  }
  return {
    circle: {
      'circle-radius': DEFAULT_CIRCLE_RADIUS,
      'circle-color': DEFAULT_FILL_COLOR,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
    },
  }
}

function singlePaint(style: StyleConfig, geom: string): MaplibrePaint {
  const color = style.fill_color ?? DEFAULT_FILL_COLOR
  const opacity = style.fill_opacity ?? DEFAULT_FILL_OPACITY
  const strokeColor = style.stroke_color ?? color
  const strokeWidth = style.stroke_width ?? DEFAULT_STROKE_WIDTH
  const radius = style.circle_radius ?? DEFAULT_CIRCLE_RADIUS

  if (geom.includes('Polygon')) {
    return {
      fill: { 'fill-color': color, 'fill-opacity': opacity },
      line: { 'line-color': strokeColor, 'line-width': strokeWidth },
    }
  }
  if (geom.includes('Line')) {
    return { line: { 'line-color': color, 'line-width': strokeWidth } }
  }
  return {
    circle: {
      'circle-radius': radius,
      'circle-color': color,
      'circle-stroke-color': strokeColor,
      'circle-stroke-width': 2,
    },
  }
}

function categorizedPaint(style: StyleConfig, geom: string): MaplibrePaint {
  const categories = style.categories!
  const field = style.field!
  const defaultColor = style.default_color ?? '#cccccc'
  const opacity = style.fill_opacity ?? DEFAULT_FILL_OPACITY
  const strokeColor = style.stroke_color ?? '#333333'
  const strokeWidth = style.stroke_width ?? DEFAULT_STROKE_WIDTH
  const radius = style.circle_radius ?? DEFAULT_CIRCLE_RADIUS

  // Build match expression: ['match', ['get', field], val1, color1, val2, color2, ..., default]
  const matchExpr: unknown[] = ['match', ['get', field]]
  for (const cat of categories) {
    matchExpr.push(cat.value, cat.color)
  }
  matchExpr.push(defaultColor)

  if (geom.includes('Polygon')) {
    return {
      fill: { 'fill-color': matchExpr, 'fill-opacity': opacity },
      line: { 'line-color': strokeColor, 'line-width': strokeWidth },
    }
  }
  if (geom.includes('Line')) {
    return { line: { 'line-color': matchExpr, 'line-width': strokeWidth } }
  }
  return {
    circle: {
      'circle-radius': radius,
      'circle-color': matchExpr,
      'circle-stroke-color': strokeColor,
      'circle-stroke-width': 2,
    },
  }
}

function graduatedPaint(style: StyleConfig, geom: string): MaplibrePaint {
  const classes = style.classes!
  const field = style.field!
  const defaultColor = style.default_color ?? '#cccccc'
  const opacity = style.fill_opacity ?? DEFAULT_FILL_OPACITY
  const strokeColor = style.stroke_color ?? '#333333'
  const strokeWidth = style.stroke_width ?? DEFAULT_STROKE_WIDTH
  const radius = style.circle_radius ?? DEFAULT_CIRCLE_RADIUS

  // Build step expression: ['step', ['to-number', ['get', field]], defaultColor, break1, color1, ...]
  const stepExpr: unknown[] = ['step', ['to-number', ['get', field]], defaultColor]
  for (const cls of classes) {
    stepExpr.push(cls.min, cls.color)
  }

  if (geom.includes('Polygon')) {
    return {
      fill: { 'fill-color': stepExpr, 'fill-opacity': opacity },
      line: { 'line-color': strokeColor, 'line-width': strokeWidth },
    }
  }
  if (geom.includes('Line')) {
    return { line: { 'line-color': stepExpr, 'line-width': strokeWidth } }
  }
  return {
    circle: {
      'circle-radius': radius,
      'circle-color': stepExpr,
      'circle-stroke-color': strokeColor,
      'circle-stroke-width': 2,
    },
  }
}

// Color palettes (ColorBrewer-inspired)
export const PALETTES = {
  blues: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
  greens: ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
  reds: ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'],
  oranges: ['#feedde', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603'],
  purples: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'],
  spectral: ['#d53e4f', '#fc8d59', '#fee08b', '#e6f598', '#99d594', '#3288bd'],
  qualitative: [
    '#e41a1c',
    '#377eb8',
    '#4daf4a',
    '#984ea3',
    '#ff7f00',
    '#ffff33',
    '#a65628',
    '#f781bf',
    '#999999',
    '#66c2a5',
  ],
} as const

export type PaletteName = keyof typeof PALETTES

export function interpolatePalette(palette: readonly string[], count: number): string[] {
  if (count <= 0) return []
  if (count === 1) return [palette[Math.floor(palette.length / 2)]]
  if (count <= palette.length) {
    // Pick evenly spaced colors from the palette
    return Array.from(
      { length: count },
      (_, i) => palette[Math.round((i / (count - 1)) * (palette.length - 1))],
    )
  }
  // Interpolate more colors than palette has
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const idx = t * (palette.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, palette.length - 1)
    if (lo === hi) return palette[lo]
    const frac = idx - lo
    return lerpColor(palette[lo], palette[hi], frac)
  })
}

function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16)
  const ag = parseInt(a.slice(3, 5), 16)
  const ab = parseInt(a.slice(5, 7), 16)
  const br = parseInt(b.slice(1, 3), 16)
  const bg = parseInt(b.slice(3, 5), 16)
  const bb = parseInt(b.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`
}

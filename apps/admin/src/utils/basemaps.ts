import type { Map as MapLibreMap, RasterSourceSpecification } from 'maplibre-gl'

/**
 * Raster basemaps, all served without an API key.
 *
 * CARTO's keyless tiles are now watermarked ("API KEY REQUIRED"), so Light uses
 * Esri's Light Gray Canvas instead — a neutral base plus a separate reference
 * layer carrying the labels, which is why a basemap is a list of tile URLs
 * rather than a single one.
 */
export const BASEMAPS = {
  light: {
    label: 'Light',
    layers: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri',
  },
  osm: {
    label: 'OSM',
    layers: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    label: 'Satellite',
    layers: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri',
  },
} as const

export type BasemapId = keyof typeof BASEMAPS

/** Highest number of tile layers any basemap uses — bounds the cleanup loop. */
const MAX_BASEMAP_LAYERS = Math.max(...Object.values(BASEMAPS).map((bm) => bm.layers.length))

const basemapId = (index: number) => `basemap-${index}`

/**
 * Sources and layers for a basemap, shaped for `new maplibregl.Map({ style })`.
 */
export function basemapStyle(id: BasemapId): {
  sources: Record<string, RasterSourceSpecification>
  layers: { id: string; type: 'raster'; source: string }[]
} {
  const bm = BASEMAPS[id]
  const sources: Record<string, RasterSourceSpecification> = {}
  bm.layers.forEach((url, i) => {
    sources[basemapId(i)] = {
      type: 'raster',
      tiles: [url],
      tileSize: 256,
      attribution: bm.attribution,
    }
  })
  return {
    sources,
    layers: bm.layers.map((_, i) => ({
      id: basemapId(i),
      type: 'raster' as const,
      source: basemapId(i),
    })),
  }
}

/**
 * Swap the basemap on a live map, keeping every tile layer below `beforeId` so
 * the collection's own layers stay on top.
 */
export function setBasemap(map: MapLibreMap, id: BasemapId, beforeId?: string): void {
  for (let i = 0; i < MAX_BASEMAP_LAYERS; i++) {
    if (map.getLayer(basemapId(i))) map.removeLayer(basemapId(i))
    if (map.getSource(basemapId(i))) map.removeSource(basemapId(i))
  }
  const { sources, layers } = basemapStyle(id)
  for (const [sourceId, spec] of Object.entries(sources)) map.addSource(sourceId, spec)
  // Added in order, each before the first feature layer: base first, labels on top.
  for (const layer of layers) map.addLayer(layer, beforeId)
}

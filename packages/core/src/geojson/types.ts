export interface GeoJsonFeature {
  type: 'Feature' | string
  geometry?: { type: string; coordinates: unknown }
  properties?: Record<string, unknown>
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection' | string
  features: GeoJsonFeature[]
}

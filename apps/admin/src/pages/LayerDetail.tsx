import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../services/api'
import type { Layer } from '../services/api'

interface GeoJsonFeature {
  id: number
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown>
}

interface ItemsResponse {
  type: 'FeatureCollection'
  numberMatched: number
  numberReturned: number
  features: GeoJsonFeature[]
}

type Tab = 'map' | 'table'

export function LayerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [layer, setLayer] = useState<Layer | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('map')

  useEffect(() => {
    if (!id) return
    api.layers
      .get(id)
      .then(setLayer)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="animate-pulse h-8 w-40 bg-gray-200 rounded" />
  if (!layer) return <p className="text-gray-500">Layer not found.</p>

  const collectionId = `${layer.workspace_name}:${layer.name}`

  return (
    <div>
      <button
        onClick={() => navigate('/layers')}
        className="text-sm text-primary-600 hover:text-primary-800 mb-4 block"
      >
        &larr; Back to layers
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{layer.name}</h1>
          <p className="text-sm text-gray-500">
            {layer.workspace_name} &middot; {layer.geometry_type ?? 'Unknown'} &middot;{' '}
            {layer.feature_count?.toLocaleString() ?? 0} features &middot; SRID {layer.srid}
          </p>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <TabButton active={tab === 'map'} onClick={() => setTab('map')}>
          Map
        </TabButton>
        <TabButton active={tab === 'table'} onClick={() => setTab('table')}>
          Table
        </TabButton>
      </div>

      {tab === 'map' ? (
        <MapView collectionId={collectionId} bbox={layer.bbox} />
      ) : (
        <TableView collectionId={collectionId} />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary-700 text-primary-700'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

function MapView({ collectionId, bbox }: { collectionId: string; bbox: string | null }) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [2.3, 46.8],
      zoom: 5,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', async () => {
      const res = await fetch(`/collections/${collectionId}/items?limit=1000`)
      const data = await res.json()

      map.addSource('features', { type: 'geojson', data })

      const geomType = data.features?.[0]?.geometry?.type ?? ''

      if (geomType.includes('Polygon')) {
        map.addLayer({
          id: 'features-fill',
          type: 'fill',
          source: 'features',
          paint: { 'fill-color': '#1B4F72', 'fill-opacity': 0.3 },
        })
        map.addLayer({
          id: 'features-line',
          type: 'line',
          source: 'features',
          paint: { 'line-color': '#1B4F72', 'line-width': 1.5 },
        })
      } else if (geomType.includes('Line')) {
        map.addLayer({
          id: 'features-line',
          type: 'line',
          source: 'features',
          paint: { 'line-color': '#1B4F72', 'line-width': 2 },
        })
      } else {
        map.addLayer({
          id: 'features-circle',
          type: 'circle',
          source: 'features',
          paint: {
            'circle-radius': 6,
            'circle-color': '#1B4F72',
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        })
      }

      // Fit to bbox
      if (bbox) {
        try {
          const coords = JSON.parse(bbox) as number[]
          if (coords.length === 4) {
            map.fitBounds(
              [
                [coords[0], coords[1]],
                [coords[2], coords[3]],
              ],
              { padding: 50 },
            )
          }
        } catch {
          /* ignore */
        }
      }

      // Popup on click
      map.on('click', (e) => {
        const layerIds = ['features-circle', 'features-fill', 'features-line'].filter((lid) =>
          map.getLayer(lid),
        )
        if (layerIds.length === 0) return
        const features = map.queryRenderedFeatures(e.point, { layers: layerIds })
        if (features.length === 0) return
        const props = features[0].properties
        const html = Object.entries(props)
          .map(([k, v]) => `<strong>${k}</strong>: ${v}`)
          .join('<br/>')
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map)
      })
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [collectionId, bbox])

  return <div ref={mapContainer} className="w-full h-[600px] rounded-lg border border-gray-200" />
}

function TableView({ collectionId }: { collectionId: string }) {
  const [items, setItems] = useState<ItemsResponse | null>(null)
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [filterError, setFilterError] = useState('')
  const limit = 20

  useEffect(() => {
    setFilterError('')
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (appliedFilter) params.set('filter', appliedFilter)
    fetch(`/collections/${collectionId}/items?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null)
          setFilterError(body?.message ?? `HTTP ${r.status}`)
          return
        }
        return r.json()
      })
      .then((data) => {
        if (data) setItems(data)
      })
  }, [collectionId, offset, appliedFilter])

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setOffset(0)
    setAppliedFilter(filter)
  }

  const handleClearFilter = () => {
    setFilter('')
    setAppliedFilter('')
    setOffset(0)
  }

  if (!items) return <div className="animate-pulse h-48 bg-gray-200 rounded-lg" />

  const columns = items.features.length > 0 ? Object.keys(items.features[0].properties) : []

  return (
    <div>
      <form onSubmit={handleFilterSubmit} className="flex gap-2 mb-3">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="CQL2 filter, e.g. departement='GIRONDE'"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="submit"
          className="bg-primary-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-800"
        >
          Filter
        </button>
        {appliedFilter && (
          <button
            type="button"
            onClick={handleClearFilter}
            className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </form>
      {filterError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-sm text-red-700 mb-3">
          {filterError}
        </div>
      )}
      <p className="text-sm text-gray-500 mb-3">
        Showing {items.numberReturned} of {items.numberMatched} features
        {appliedFilter && <span className="ml-1 text-primary-600">— filtered</span>}
      </p>
      <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[500px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b border-gray-200">
              <th className="text-left px-3 py-2 font-medium text-gray-600">ID</th>
              {columns.map((col) => (
                <th
                  key={col}
                  className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.features.map((f) => (
              <tr key={f.id} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 text-gray-500">{f.id}</td>
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate"
                  >
                    {String(f.properties[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
        >
          Previous
        </button>
        <span className="text-sm text-gray-500">
          Page {Math.floor(offset / limit) + 1} of {Math.ceil(items.numberMatched / limit)}
        </span>
        <button
          disabled={offset + limit >= items.numberMatched}
          onClick={() => setOffset(offset + limit)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
        >
          Next
        </button>
      </div>
    </div>
  )
}

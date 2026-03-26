import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../services/api'
import type {
  Collection,
  Workspace,
  ColumnSchema,
  ImportHistory,
  StyleConfig,
  ClassifyResult,
} from '../services/api'
import {
  styleToMaplibrePaint,
  PALETTES,
  interpolatePalette,
  type PaletteName,
} from '../utils/styleToMaplibre'

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

type Tab = 'map' | 'table' | 'schema' | 'history' | 'settings' | 'style' | 'api' | 'export'

export function CollectionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [collection, setCollection] = useState<Collection | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('map')

  useEffect(() => {
    if (!id) return
    api.collections
      .get(id)
      .then(setCollection)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="animate-pulse h-8 w-40 bg-gray-200 rounded" />
  if (!collection) return <p className="text-gray-500">Collection not found.</p>

  const collectionId = `${collection.workspace_name}:${collection.name}`

  return (
    <div>
      <button
        onClick={() => navigate('/collections')}
        className="text-sm text-primary-600 hover:text-primary-800 mb-4 block"
      >
        &larr; Back to collections
      </button>

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{collection.name}</h1>
        <p className="text-sm text-gray-500">
          {collection.workspace_name} &middot; {collection.geometry_type ?? 'Unknown'} &middot;{' '}
          {collection.feature_count?.toLocaleString() ?? 0} features &middot; SRID {collection.srid}
        </p>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <TabButton active={tab === 'map'} onClick={() => setTab('map')}>
          Map
        </TabButton>
        <TabButton active={tab === 'table'} onClick={() => setTab('table')}>
          Table
        </TabButton>
        <TabButton active={tab === 'schema'} onClick={() => setTab('schema')}>
          Schema
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
          History
        </TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
          Settings
        </TabButton>
        <TabButton active={tab === 'style'} onClick={() => setTab('style')}>
          Style
        </TabButton>
        <TabButton active={tab === 'api'} onClick={() => setTab('api')}>
          API
        </TabButton>
        <TabButton active={tab === 'export'} onClick={() => setTab('export')}>
          Export
        </TabButton>
      </div>

      {tab === 'map' && (
        <MapView
          collectionId={collectionId}
          bbox={collection.bbox}
          geometryType={collection.geometry_type}
          style={collection.style}
        />
      )}
      {tab === 'table' && <TableView collectionId={collectionId} />}
      {tab === 'schema' && <SchemaView collectionId={collection.id} />}
      {tab === 'history' && <HistoryView collectionId={collection.id} />}
      {tab === 'settings' && <SettingsView collection={collection} onUpdate={setCollection} />}
      {tab === 'style' && <StyleView collection={collection} onUpdate={setCollection} />}
      {tab === 'api' && <ApiView collection={collection} collectionId={collectionId} />}
      {tab === 'export' && <ExportView collection={collection} />}
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

const BASEMAPS = {
  osm: {
    label: 'OSM',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '&copy; OpenStreetMap contributors',
  },
  light: {
    label: 'Light',
    tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'],
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  satellite: {
    label: 'Satellite',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri',
  },
} as const

type BasemapId = keyof typeof BASEMAPS

function parseBbox(bbox: string | number[] | null): number[] | null {
  if (!bbox) return null
  try {
    const coords = typeof bbox === 'string' ? (JSON.parse(bbox) as number[]) : bbox
    return coords.length === 4 ? coords : null
  } catch {
    return null
  }
}

function fitToBbox(map: maplibregl.Map, bbox: string | number[] | null) {
  const coords = parseBbox(bbox)
  if (!coords) return
  map.fitBounds(
    [
      [coords[0], coords[1]],
      [coords[2], coords[3]],
    ],
    { padding: 50 },
  )
}

function MapView({
  collectionId,
  bbox,
  geometryType,
  style,
}: {
  collectionId: string
  bbox: string | number[] | null
  geometryType: string | null
  style?: StyleConfig | null
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [basemap, setBasemap] = useState<BasemapId>('osm')

  const layerName = collectionId.includes(':') ? collectionId.split(':')[1] : collectionId

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: BASEMAPS.osm.tiles as unknown as string[],
            tileSize: 256,
            attribution: BASEMAPS.osm.attribution,
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: [2.3, 46.8],
      zoom: 5,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource('features', {
        type: 'vector',
        tiles: [`${window.location.origin}/collections/${collectionId}/tiles/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 14,
      })

      applyMapStyle(map, layerName, geometryType, style ?? null)
      fitToBbox(map, bbox)

      map.on('click', (e) => {
        const collectionIds = ['features-circle', 'features-fill', 'features-line'].filter((lid) =>
          map.getLayer(lid),
        )
        if (collectionIds.length === 0) return
        const features = map.queryRenderedFeatures(e.point, { layers: collectionIds })
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
  }, [collectionId, bbox, geometryType, layerName, style])

  // Switch basemap tiles when selection changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const bm = BASEMAPS[basemap]
    map.removeLayer('basemap')
    map.removeSource('basemap')
    map.addSource('basemap', {
      type: 'raster',
      tiles: bm.tiles as unknown as string[],
      tileSize: 256,
      attribution: bm.attribution,
    })
    // Insert basemap below all feature layers
    const firstFeatureLayer = ['features-fill', 'features-line', 'features-circle'].find((lid) =>
      map.getLayer(lid),
    )
    map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' }, firstFeatureLayer)
  }, [basemap])

  return (
    <div className="relative">
      <div ref={mapContainer} className="w-full h-[600px] rounded-lg border border-gray-200" />
      {/* Fit bounds button */}
      <button
        title="Fit to collection extent"
        onClick={() => mapRef.current && fitToBbox(mapRef.current, bbox)}
        className="absolute top-2.5 left-2.5 bg-white rounded shadow p-1.5 hover:bg-gray-100 transition-colors border border-gray-300"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>
      {/* Basemap switcher */}
      <div className="absolute top-2.5 left-12 flex rounded shadow border border-gray-300 overflow-hidden text-xs">
        {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
          <button
            key={id}
            onClick={() => setBasemap(id)}
            className={`px-2.5 py-1.5 ${basemap === id ? 'bg-primary-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
          >
            {BASEMAPS[id].label}
          </button>
        ))}
      </div>
      {style && <Legend style={style} geometryType={geometryType} />}
    </div>
  )
}

function applyMapStyle(
  map: maplibregl.Map,
  layerName: string,
  geometryType: string | null,
  style: StyleConfig | null,
) {
  // Remove existing feature layers
  for (const lid of ['features-circle', 'features-fill', 'features-line']) {
    if (map.getLayer(lid)) map.removeLayer(lid)
  }

  const paint = styleToMaplibrePaint(style, geometryType)

  if (paint.fill) {
    map.addLayer({
      id: 'features-fill',
      type: 'fill',
      source: 'features',
      'source-layer': layerName,
      paint: paint.fill as maplibregl.FillLayerSpecification['paint'],
    })
  }
  if (paint.line) {
    map.addLayer({
      id: 'features-line',
      type: 'line',
      source: 'features',
      'source-layer': layerName,
      paint: paint.line as maplibregl.LineLayerSpecification['paint'],
    })
  }
  if (paint.circle) {
    map.addLayer({
      id: 'features-circle',
      type: 'circle',
      source: 'features',
      'source-layer': layerName,
      paint: paint.circle as maplibregl.CircleLayerSpecification['paint'],
    })
  }
}

function Legend({ style, geometryType }: { style: StyleConfig; geometryType: string | null }) {
  const geom = (geometryType ?? '').toLowerCase()
  const isLine = geom.includes('line')
  const isPoint = !geom.includes('polygon') && !isLine

  const renderSymbol = (color: string) => {
    if (isPoint) {
      return (
        <span
          className="inline-block w-3 h-3 rounded-full border border-gray-300 shrink-0"
          style={{ backgroundColor: color }}
        />
      )
    }
    if (isLine) {
      return (
        <span
          className="inline-block w-5 h-0.5 shrink-0 rounded"
          style={{ backgroundColor: color }}
        />
      )
    }
    return (
      <span
        className="inline-block w-4 h-3 rounded-sm border border-gray-300 shrink-0"
        style={{ backgroundColor: color, opacity: style.fill_opacity ?? 0.6 }}
      />
    )
  }

  if (style.type === 'single') {
    return (
      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur rounded-lg shadow px-3 py-2 text-xs flex items-center gap-2">
        {renderSymbol(style.fill_color ?? '#1B4F72')}
        <span className="text-gray-700">All features</span>
      </div>
    )
  }

  if (style.type === 'categorized' && style.categories?.length) {
    return (
      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur rounded-lg shadow px-3 py-2 text-xs max-h-60 overflow-y-auto">
        <div className="font-medium text-gray-600 mb-1">{style.field}</div>
        {style.categories.map((cat, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            {renderSymbol(cat.color)}
            <span className="text-gray-700">{cat.label ?? String(cat.value)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (style.type === 'graduated' && style.classes?.length) {
    return (
      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur rounded-lg shadow px-3 py-2 text-xs max-h-60 overflow-y-auto">
        <div className="font-medium text-gray-600 mb-1">{style.field}</div>
        {style.classes.map((cls, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            {renderSymbol(cls.color)}
            <span className="text-gray-700">
              {cls.label ?? `${formatNum(cls.min)} – ${formatNum(cls.max)}`}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return null
}

function formatNum(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
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
      <form onSubmit={handleFilterSubmit} className="flex gap-2 mb-1">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="CQL2 filter, e.g. name='Paris'"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 bg-primary-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-800"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
            />
          </svg>
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
      <p className="text-xs text-gray-400 mb-3">
        Uses{' '}
        <a
          href="https://docs.ogc.org/is/21-065r2/21-065r2.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-500 hover:underline"
        >
          CQL2
        </a>{' '}
        syntax — e.g. <code className="bg-gray-100 px-1 rounded text-xs">name LIKE 'Paris%'</code>,{' '}
        <code className="bg-gray-100 px-1 rounded text-xs">population &gt; 10000</code>,{' '}
        <code className="bg-gray-100 px-1 rounded text-xs">status IN ('active','pending')</code>
      </p>
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

function SchemaView({ collectionId }: { collectionId: string }) {
  const [columns, setColumns] = useState<ColumnSchema[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.collections
      .schema(collectionId)
      .then((data) => {
        setColumns(data.columns)
        setTotalCount(data.total_count)
      })
      .finally(() => setLoading(false))
  }, [collectionId])

  if (loading) return <div className="animate-pulse h-48 bg-gray-200 rounded-lg" />

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">
        {columns.length} columns &middot; {totalCount.toLocaleString()} rows
      </p>
      <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-200">
              <th className="text-left px-3 py-2 font-medium text-gray-600">Column</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Type</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Nullable</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Non-null</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Nulls</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Distinct</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Min</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Max</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col) => (
              <tr key={col.column} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 font-mono text-gray-900">{col.column}</td>
                <td className="px-3 py-2 text-gray-600">
                  {col.geometry_type ? `${col.type} (${col.geometry_type}, ${col.srid})` : col.type}
                </td>
                <td className="px-3 py-2 text-gray-500">{col.nullable ? 'yes' : 'no'}</td>
                <td className="px-3 py-2 text-gray-700">
                  {col.non_null != null ? col.non_null.toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {col.null_count != null ? col.null_count.toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {col.distinct != null ? col.distinct.toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{col.min ?? '—'}</td>
                <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{col.max ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface FieldConfig {
  source: string
  alias: string
  enabled: boolean
}

function SettingsView({
  collection,
  onUpdate,
}: {
  collection: Collection
  onUpdate: (c: Collection) => void
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [columns, setColumns] = useState<ColumnSchema[]>([])
  const [workspaceId, setWorkspaceId] = useState(collection.workspace_id)
  const [description, setDescription] = useState(collection.description ?? '')
  const [attribution, setAttribution] = useState(collection.attribution ?? '')
  const [datetimeColumn, setDatetimeColumn] = useState(collection.datetime_column ?? '')
  const [fields, setFields] = useState<FieldConfig[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.workspaces.list().then(setWorkspaces)
    api.collections.schema(collection.id).then((data) => {
      setColumns(data.columns)
      // Build field config from schema + existing exposed_fields
      const dataCols = data.columns.filter(
        (c) => c.column !== collection.geometry_column && c.column !== collection.id_column,
      )
      const exposed = collection.exposed_fields
      if (exposed && exposed.length > 0) {
        const exposedMap = new Map(exposed.map((f) => [f.source, f.alias ?? f.source]))
        setFields(
          dataCols.map((c) => ({
            source: c.column,
            alias: exposedMap.get(c.column) ?? c.column,
            enabled: exposedMap.has(c.column),
          })),
        )
      } else {
        setFields(dataCols.map((c) => ({ source: c.column, alias: c.column, enabled: true })))
      }
    })
  }, [collection.id, collection.geometry_column, collection.id_column, collection.exposed_fields])

  const dateColumns = columns.filter(
    (c) =>
      c.type.includes('timestamp') ||
      c.type === 'date' ||
      c.type === 'text' ||
      c.type === 'character varying',
  )

  const allEnabled = fields.every((f) => f.enabled)
  const noAliases = fields.every((f) => f.alias === f.source)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      // If all fields are enabled with no aliases, set exposed_fields to null
      const exposedFields =
        allEnabled && noAliases
          ? null
          : fields
              .filter((f) => f.enabled)
              .map((f) =>
                f.alias !== f.source ? { source: f.source, alias: f.alias } : { source: f.source },
              )

      const updated = await api.collections.update(collection.id, {
        workspace_id: workspaceId !== collection.workspace_id ? workspaceId : undefined,
        description: description || null,
        attribution: attribution || null,
        datetime_column: datetimeColumn || null,
        exposed_fields: exposedFields,
      })
      onUpdate(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleField = (source: string) => {
    setFields((prev) => prev.map((f) => (f.source === source ? { ...f, enabled: !f.enabled } : f)))
  }

  const setAlias = (source: string, alias: string) => {
    setFields((prev) => prev.map((f) => (f.source === source ? { ...f, alias } : f)))
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left column — general settings + save */}
        <div className="self-start space-y-5">
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">General</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Workspace</label>
              <select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="A short description of this collection"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Attribution</label>
              <input
                type="text"
                value={attribution}
                onChange={(e) => setAttribution(e.target.value)}
                placeholder="e.g. OpenStreetMap contributors"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Datetime column
              </label>
              <select
                value={datetimeColumn}
                onChange={(e) => setDatetimeColumn(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">None</option>
                {dateColumns.map((c) => (
                  <option key={c.column} value={c.column}>
                    {c.column} ({c.type})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Enables the OGC <code>?datetime=</code> filter on this collection
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              {saving ? 'Saving...' : 'Save'}
            </button>
            {saved && <span className="text-sm text-green-600">Saved successfully</span>}
          </div>
        </div>

        {/* Right column — exposed fields */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 self-start">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Exposed fields
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            Choose which columns are exposed in the API. Uncheck a column to hide it. Set an alias
            to rename it in the API response.
          </p>
          {fields.length > 0 ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-3 py-2 font-medium text-gray-600 w-10">On</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Column</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Alias</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.source} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          onChange={() => toggleField(f.source)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700">{f.source}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={f.alias}
                          onChange={(e) => setAlias(f.source, e.target.value)}
                          disabled={!f.enabled}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="animate-pulse h-20 bg-gray-100 rounded-lg" />
          )}
        </div>
      </div>
    </form>
  )
}

function StyleView({
  collection,
  onUpdate,
}: {
  collection: Collection
  onUpdate: (c: Collection) => void
}) {
  const [columns, setColumns] = useState<ColumnSchema[]>([])
  const [styleType, setStyleType] = useState<'single' | 'categorized' | 'graduated'>(
    collection.style?.type ?? 'single',
  )
  const [fillColor, setFillColor] = useState(collection.style?.fill_color ?? '#1B4F72')
  const [fillOpacity, setFillOpacity] = useState(collection.style?.fill_opacity ?? 0.3)
  const [strokeColor, setStrokeColor] = useState(collection.style?.stroke_color ?? '#333333')
  const [strokeWidth, setStrokeWidth] = useState(collection.style?.stroke_width ?? 1.5)
  const [showStroke, setShowStroke] = useState((collection.style?.stroke_width ?? 1.5) > 0)
  const [field, setField] = useState(collection.style?.field ?? '')
  const [categories, setCategories] = useState(collection.style?.categories ?? [])
  const [method, setMethod] = useState<'equal_interval' | 'quantile'>(
    (collection.style?.method as 'equal_interval' | 'quantile') ?? 'quantile',
  )
  const [numClasses, setNumClasses] = useState(collection.style?.classes?.length ?? 5)
  const [classes, setClasses] = useState(collection.style?.classes ?? [])
  const [palette, setPalette] = useState<PaletteName>('blues')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [classifyLoading, setClassifyLoading] = useState(false)

  const [hasStyle, setHasStyle] = useState(collection.style != null)

  // Live preview style — null when no style is active
  const effectiveStrokeWidth = showStroke ? strokeWidth : 0
  const previewStyle = hasStyle ? buildPreviewStyle() : null

  useEffect(() => {
    api.collections.schema(collection.id).then((data) => {
      setColumns(
        data.columns.filter(
          (c) => c.column !== collection.geometry_column && c.column !== collection.id_column,
        ),
      )
    })
  }, [collection.id, collection.geometry_column, collection.id_column])

  const numericColumns = columns.filter((c) =>
    ['integer', 'bigint', 'smallint', 'double precision', 'real', 'numeric'].includes(c.type),
  )

  function buildPreviewStyle(): StyleConfig {
    const strokeProps = {
      stroke_color: strokeColor,
      stroke_width: effectiveStrokeWidth,
    }
    if (styleType === 'single') {
      return {
        type: 'single',
        fill_color: fillColor,
        fill_opacity: fillOpacity,
        ...strokeProps,
      }
    }
    if (styleType === 'categorized') {
      return {
        type: 'categorized',
        field,
        categories,
        fill_opacity: fillOpacity,
        ...strokeProps,
        default_color: '#cccccc',
      }
    }
    return {
      type: 'graduated',
      field,
      method,
      classes,
      fill_opacity: fillOpacity,
      ...strokeProps,
      default_color: '#cccccc',
    }
  }

  async function handleClassify() {
    if (!field) return
    setClassifyLoading(true)
    setError('')
    try {
      const result: ClassifyResult = await api.collections.classify(collection.id, {
        field,
        type: styleType,
        classes: numClasses,
      })

      if (result.type === 'categorized' && result.categories) {
        const colors = interpolatePalette(
          PALETTES[styleType === 'categorized' ? 'qualitative' : palette],
          result.categories.length,
        )
        setCategories(
          result.categories.map((c, i) => ({
            value: c.value,
            color: colors[i] ?? '#cccccc',
          })),
        )
      }
      if (result.type === 'graduated' && result.classes) {
        const colors = interpolatePalette(PALETTES[palette], result.classes.length)
        setClasses(
          result.classes.map((c, i) => ({
            min: c.min,
            max: c.max,
            color: colors[i] ?? '#cccccc',
          })),
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Classification failed')
    } finally {
      setClassifyLoading(false)
    }
  }

  function applyPalette(name: PaletteName) {
    setPalette(name)
    if (styleType === 'categorized' && categories.length > 0) {
      const colors = interpolatePalette(PALETTES[name], categories.length)
      setCategories(categories.map((c, i) => ({ ...c, color: colors[i] ?? c.color })))
    }
    if (styleType === 'graduated' && classes.length > 0) {
      const colors = interpolatePalette(PALETTES[name], classes.length)
      setClasses(classes.map((c, i) => ({ ...c, color: colors[i] ?? c.color })))
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const styleToSave = buildPreviewStyle()
      const updated = await api.collections.update(collection.id, { style: styleToSave })
      onUpdate(updated)
      setHasStyle(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setSaving(true)
    setError('')
    try {
      const updated = await api.collections.update(collection.id, { style: null })
      onUpdate(updated)
      setHasStyle(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setSaving(false)
    }
  }

  const collectionId = `${collection.workspace_name}:${collection.name}`

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Classification type
          </label>
          <div className="flex gap-2">
            {(['single', 'categorized', 'graduated'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setStyleType(t)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  styleType === t
                    ? 'bg-primary-700 text-white border-primary-700'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {styleType === 'single' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Fill color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={fillColor}
                  onChange={(e) => setFillColor(e.target.value)}
                  className="w-10 h-8 rounded border border-gray-300 cursor-pointer"
                />
                <span className="text-sm text-gray-500 font-mono">{fillColor}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Opacity: {fillOpacity.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={fillOpacity}
                onChange={(e) => setFillOpacity(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        )}

        {(styleType === 'categorized' || styleType === 'graduated') && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Field</label>
              <select
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select a column...</option>
                {(styleType === 'graduated' ? numericColumns : columns).map((c) => (
                  <option key={c.column} value={c.column}>
                    {c.column} ({c.type})
                  </option>
                ))}
              </select>
            </div>

            {styleType === 'graduated' && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm text-gray-600 mb-1">Method</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as 'equal_interval' | 'quantile')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="quantile">Quantile</option>
                    <option value="equal_interval">Equal Interval</option>
                  </select>
                </div>
                <div className="w-24">
                  <label className="block text-sm text-gray-600 mb-1">Classes</label>
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={numClasses}
                    onChange={(e) => setNumClasses(parseInt(e.target.value) || 5)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-600 mb-1">Color palette</label>
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(PALETTES) as PaletteName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => applyPalette(name)}
                    className={`flex rounded overflow-hidden border-2 transition-colors ${
                      palette === name ? 'border-primary-700' : 'border-transparent'
                    }`}
                    title={name}
                  >
                    {PALETTES[name].slice(0, 5).map((color, i) => (
                      <span key={i} className="w-4 h-4" style={{ backgroundColor: color }} />
                    ))}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Opacity: {fillOpacity.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={fillOpacity}
                onChange={(e) => setFillOpacity(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>

            <button
              type="button"
              onClick={handleClassify}
              disabled={!field || classifyLoading}
              className="w-full bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition-colors"
            >
              {classifyLoading ? 'Classifying...' : 'Auto-classify'}
            </button>

            {styleType === 'categorized' && categories.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-12">Color</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Value</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((cat, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-1.5">
                          <input
                            type="color"
                            value={cat.color}
                            onChange={(e) => {
                              const updated = [...categories]
                              updated[i] = { ...updated[i], color: e.target.value }
                              setCategories(updated)
                            }}
                            className="w-8 h-6 rounded border border-gray-300 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-gray-700 font-mono text-xs">
                          {String(cat.value)}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={cat.label ?? ''}
                            onChange={(e) => {
                              const updated = [...categories]
                              updated[i] = {
                                ...updated[i],
                                label: e.target.value || undefined,
                              }
                              setCategories(updated)
                            }}
                            placeholder={String(cat.value)}
                            className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {styleType === 'graduated' && classes.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-12">Color</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Range</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map((cls, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-1.5">
                          <input
                            type="color"
                            value={cls.color}
                            onChange={(e) => {
                              const updated = [...classes]
                              updated[i] = { ...updated[i], color: e.target.value }
                              setClasses(updated)
                            }}
                            className="w-8 h-6 rounded border border-gray-300 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-gray-700 text-xs font-mono">
                          {formatNum(cls.min)} – {formatNum(cls.max)}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={cls.label ?? ''}
                            onChange={(e) => {
                              const updated = [...classes]
                              updated[i] = {
                                ...updated[i],
                                label: e.target.value || undefined,
                              }
                              setClasses(updated)
                            }}
                            placeholder={`${formatNum(cls.min)} – ${formatNum(cls.max)}`}
                            className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Stroke controls — shared across all style types */}
        <div className="space-y-3 border-t border-gray-200 pt-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showStroke"
              checked={showStroke}
              onChange={(e) => setShowStroke(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="showStroke" className="text-sm font-medium text-gray-700">
              Stroke (border)
            </label>
          </div>
          {showStroke && (
            <div className="flex gap-4 items-end">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={strokeColor}
                    onChange={(e) => setStrokeColor(e.target.value)}
                    className="w-10 h-8 rounded border border-gray-300 cursor-pointer"
                  />
                  <span className="text-sm text-gray-500 font-mono">{strokeColor}</span>
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">
                  Width: {strokeWidth.toFixed(1)}px
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="5"
                  step="0.5"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            {saving ? 'Saving...' : 'Save style'}
          </button>
          {hasStyle && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                />
              </svg>
              Remove style
            </button>
          )}
          {saved && <span className="text-sm text-green-600">Saved successfully</span>}
        </div>
      </div>

      <div>
        <MapView
          collectionId={collectionId}
          bbox={collection.bbox}
          geometryType={collection.geometry_type}
          style={previewStyle}
        />
      </div>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  )
}

function HistoryView({ collectionId }: { collectionId: string }) {
  const [history, setHistory] = useState<ImportHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const data = await api.collections.history(collectionId)
      if (cancelled) return
      setHistory(data)
      setLoading(false)

      // Auto-refresh if any import is in progress
      if (data.some((h) => h.status === 'pending' || h.status === 'running')) {
        setTimeout(load, 2000)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [collectionId])

  if (loading) return <div className="animate-pulse h-48 bg-gray-200 rounded-lg" />

  if (history.length === 0) {
    return <p className="text-sm text-gray-500">No import history for this collection.</p>
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">{history.length} import(s)</p>
      <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-200">
              <th className="text-left px-3 py-2 font-medium text-gray-600">Date</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Source</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Progress</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Features</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">SRID</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Duration</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {new Date(h.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-gray-700">{h.source_file}</td>
                <td className="px-3 py-2 w-32">
                  {h.status === 'running' || h.status === 'pending' ? (
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className="bg-primary-600 h-1.5 rounded-full transition-all"
                        style={{ width: `${h.progress}%` }}
                      />
                    </div>
                  ) : h.status === 'completed' ? (
                    <span className="text-gray-500">100%</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {h.status === 'running'
                    ? `${h.imported_features?.toLocaleString() ?? 0} / ${h.total_features?.toLocaleString() ?? '?'}`
                    : (h.feature_count?.toLocaleString() ?? '—')}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {h.source_srid === h.target_srid
                    ? h.target_srid
                    : `${h.source_srid} → ${h.target_srid}`}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {h.duration_ms != null ? `${(h.duration_ms / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      h.status === 'completed'
                        ? 'bg-green-100 text-green-700'
                        : h.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : h.status === 'running'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {h.status}
                  </span>
                  {h.error && <p className="text-xs text-red-600 mt-1">{h.error}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- API tab ---

import { exportBruno, exportPostman } from '../utils/apiExport'

function DownloadSmallIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  )
}

function ExternalSmallIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
      />
    </svg>
  )
}

const EXPORT_FORMATS = [
  { value: 'geojson', label: 'GeoJSON', extension: '.geojson', mime: 'application/geo+json' },
] as const

type ExportFormat = (typeof EXPORT_FORMATS)[number]['value']

function ExportView({ collection }: { collection: Collection }) {
  const [filter, setFilter] = useState('')
  const [bbox, setBbox] = useState('')
  const [limit, setLimit] = useState('')
  const [format, setFormat] = useState<ExportFormat>('geojson')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [resultInfo, setResultInfo] = useState('')

  const handleExport = async () => {
    setError('')
    setResultInfo('')
    setExporting(true)
    try {
      const params: { filter?: string; bbox?: string; limit?: number } = {}
      if (filter.trim()) params.filter = filter.trim()
      if (bbox.trim()) params.bbox = bbox.trim()
      if (limit.trim()) {
        const n = parseInt(limit.trim(), 10)
        if (isNaN(n) || n <= 0) {
          setError('Limit must be a positive integer')
          setExporting(false)
          return
        }
        params.limit = n
      }

      const url = api.collections.exportUrl(collection.id, params)
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? `HTTP ${res.status}`)
      }

      const data = await res.json()
      const count = data.features?.length ?? 0

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${collection.workspace_name}_${collection.name}.geojson`
      a.click()
      URL.revokeObjectURL(a.href)

      setResultInfo(`${count.toLocaleString()} feature${count !== 1 ? 's' : ''} exported`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Format</h2>
        <div className="flex gap-3">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFormat(f.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                format === f.value
                  ? 'bg-primary-50 border-primary-300 text-primary-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
          Filters
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Optional — leave empty to export the entire collection.
        </p>
        <div className="space-y-4 max-w-xl">
          <div>
            <label htmlFor="export-filter" className="block text-sm font-medium text-gray-700 mb-1">
              CQL2 filter
            </label>
            <input
              id="export-filter"
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="e.g. name='Paris'"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              <a
                href="https://docs.ogc.org/is/21-065r2/21-065r2.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-500 hover:underline"
              >
                CQL2 documentation
              </a>{' '}
              — e.g. <code className="bg-gray-100 px-1 rounded">name='Paris'</code>,{' '}
              <code className="bg-gray-100 px-1 rounded">population &gt; 10000</code>
            </p>
          </div>
          <div>
            <label htmlFor="export-bbox" className="block text-sm font-medium text-gray-700 mb-1">
              Bounding box
            </label>
            <input
              id="export-bbox"
              type="text"
              value={bbox}
              onChange={(e) => setBbox(e.target.value)}
              placeholder="minLon,minLat,maxLon,maxLat"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="export-limit" className="block text-sm font-medium text-gray-700 mb-1">
              Limit
            </label>
            <input
              id="export-limit"
              type="number"
              min={1}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="No limit"
              className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-gray-400 mt-1">Maximum number of features to export</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 bg-primary-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition-colors"
        >
          <DownloadIcon />
          {exporting ? 'Exporting...' : 'Export'}
        </button>
        {resultInfo && <span className="text-sm text-green-600 font-medium">{resultInfo}</span>}
      </div>
    </div>
  )
}

function CurlBlock({
  label,
  description,
  curl,
}: {
  label: string
  description: string
  curl: string
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(curl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
        <div>
          <span className="text-sm font-medium text-gray-900">{label}</span>
          <span className="ml-2 text-xs text-gray-400">{description}</span>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
            />
          </svg>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="px-4 py-3 text-sm text-gray-800 bg-white overflow-x-auto whitespace-pre-wrap break-all">
        <code>{curl}</code>
      </pre>
    </div>
  )
}

function ApiView({ collection, collectionId }: { collection: Collection; collectionId: string }) {
  const base = window.location.origin
  const col = collectionId
  const bbox: number[] | null = collection.bbox
    ? typeof collection.bbox === 'string'
      ? JSON.parse(collection.bbox)
      : collection.bbox
    : null
  const bboxStr = bbox ? bbox.join(',') : '-1.5,43.2,1.3,45.8'

  const sections: Array<{
    title: string
    note?: React.ReactNode
    items: Array<{ label: string; description: string; curl: string }>
  }> = [
    {
      title: 'Collection metadata',
      items: [
        {
          label: 'GET /collections/{id}',
          description: 'Collection description and metadata',
          curl: `curl "${base}/collections/${col}"`,
        },
        {
          label: 'GET /collections/{id}/queryables',
          description: 'Available properties for filtering',
          curl: `curl "${base}/collections/${col}/queryables"`,
        },
      ],
    },
    {
      title: 'Features (GeoJSON)',
      items: [
        {
          label: 'GET /collections/{id}/items',
          description: 'First page of features',
          curl: `curl "${base}/collections/${col}/items"`,
        },
        {
          label: 'Pagination',
          description: 'Limit results and paginate',
          curl: `curl "${base}/collections/${col}/items?limit=10&offset=0"`,
        },
        {
          label: 'Bounding box filter',
          description: 'Spatial filter with bbox',
          curl: `curl "${base}/collections/${col}/items?bbox=${bboxStr}"`,
        },
        {
          label: 'Single feature',
          description: 'Get a feature by ID',
          curl: `curl "${base}/collections/${col}/items/1"`,
        },
      ],
    },
    {
      title: 'Filtering',
      note: (
        <>
          Supports{' '}
          <a
            href="https://docs.ogc.org/is/21-065r2/21-065r2.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-500 hover:underline"
          >
            OGC CQL2
          </a>{' '}
          for text and JSON filter expressions, plus spatial shortcuts (point intersection, radius
          search).
        </>
      ),
      items: [
        {
          label: 'CQL2 Text filter',
          description: 'Filter features with CQL2 expression',
          curl: `curl "${base}/collections/${col}/items?filter-lang=cql2-text&filter=property='value'"`,
        },
        {
          label: 'CQL2 JSON filter',
          description: 'Filter with CQL2 JSON body',
          curl: `curl "${base}/collections/${col}/items?filter-lang=cql2-json&filter=%7B%22op%22%3A%22%3D%22%2C%22args%22%3A%5B%7B%22property%22%3A%22property%22%7D%2C%22value%22%5D%7D"`,
        },
        {
          label: 'Point intersection',
          description: 'Features intersecting a point',
          curl: `curl "${base}/collections/${col}/items?lon=${bbox ? ((bbox[0] + bbox[2]) / 2).toFixed(4) : '2.3488'}&lat=${bbox ? ((bbox[1] + bbox[3]) / 2).toFixed(4) : '48.8534'}"`,
        },
        {
          label: 'Radius search',
          description: 'Features within a radius (meters)',
          curl: `curl "${base}/collections/${col}/items?lon=${bbox ? ((bbox[0] + bbox[2]) / 2).toFixed(4) : '2.3488'}&lat=${bbox ? ((bbox[1] + bbox[3]) / 2).toFixed(4) : '48.8534'}&radius=5000"`,
        },
      ],
    },
    {
      title: 'Coordinate reference systems',
      items: [
        {
          label: 'Reproject output',
          description: 'Get features in a different CRS',
          curl: `curl "${base}/collections/${col}/items?limit=5&crs=http://www.opengis.net/def/crs/EPSG/0/3857"`,
        },
        {
          label: 'Bbox in different CRS',
          description: 'Specify bbox coordinate system',
          curl: `curl "${base}/collections/${col}/items?bbox=0,0,1,1&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/4326"`,
        },
      ],
    },
    {
      title: 'Vector tiles',
      items: [
        {
          label: 'GET /collections/{id}/tiles/{z}/{x}/{y}.pbf',
          description: 'Mapbox Vector Tile (MVT)',
          curl: `curl "${base}/collections/${col}/tiles/6/32/22.pbf" --output tile.pbf`,
        },
      ],
    },
  ]

  // Add datetime section if collection has a datetime column
  if (collection.datetime_column) {
    const dtSection = {
      title: 'Temporal filter',
      items: [
        {
          label: 'Instant',
          description: 'Features at a specific time',
          curl: `curl "${base}/collections/${col}/items?datetime=2024-01-01T00:00:00Z"`,
        },
        {
          label: 'Interval',
          description: 'Features within a time range',
          curl: `curl "${base}/collections/${col}/items?datetime=2024-01-01T00:00:00Z/2024-12-31T23:59:59Z"`,
        },
        {
          label: 'Open-ended',
          description: 'Features after a date',
          curl: `curl "${base}/collections/${col}/items?datetime=2024-01-01T00:00:00Z/.."`,
        },
      ],
    }
    // Insert after "Filtering"
    sections.splice(3, 0, dtSection)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <p className="text-sm text-gray-500">
          API examples for{' '}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-primary-700 font-mono text-xs">
            {collectionId}
          </code>
          . All endpoints follow the{' '}
          <a
            href="https://ogcapi.ogc.org/features/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:underline"
          >
            OGC API — Features
          </a>{' '}
          specification.
        </p>
        <div className="flex items-center gap-2 ml-4 shrink-0">
          <span className="text-xs text-gray-400">Export:</span>
          <button
            onClick={() => exportPostman(collectionId, collection)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <DownloadSmallIcon />
            Postman
          </button>
          <button
            onClick={() => exportBruno(collectionId, collection)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <DownloadSmallIcon />
            Bruno
          </button>
          <a
            href="/api"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ExternalSmallIcon />
            OpenAPI
          </a>
        </div>
      </div>
      {sections.map((section) => (
        <div key={section.title}>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {section.title}
          </h3>
          {section.note && <p className="text-xs text-gray-400 mb-3">{section.note}</p>}
          <div className="space-y-3">
            {section.items.map((item) => (
              <CurlBlock key={item.label} {...item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

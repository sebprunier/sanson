import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../services/api'
import type {
  Layer,
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

type Tab = 'map' | 'table' | 'schema' | 'history' | 'settings' | 'style'

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
        <a
          href={api.layers.exportUrl(layer.id)}
          download
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
        >
          <DownloadIcon />
          Export GeoJSON
        </a>
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
      </div>

      {tab === 'map' && (
        <MapView
          collectionId={collectionId}
          bbox={layer.bbox}
          geometryType={layer.geometry_type}
          style={layer.style}
        />
      )}
      {tab === 'table' && <TableView collectionId={collectionId} />}
      {tab === 'schema' && <SchemaView layerId={layer.id} />}
      {tab === 'history' && <HistoryView layerId={layer.id} />}
      {tab === 'settings' && <SettingsView layer={layer} onUpdate={setLayer} />}
      {tab === 'style' && <StyleView layer={layer} onUpdate={setLayer} />}
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

function MapView({
  collectionId,
  bbox,
  geometryType,
  style,
}: {
  collectionId: string
  bbox: string | null
  geometryType: string | null
  style?: StyleConfig | null
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const layerName = collectionId.includes(':') ? collectionId.split(':')[1] : collectionId

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

    map.on('load', () => {
      map.addSource('features', {
        type: 'vector',
        tiles: [`${window.location.origin}/collections/${collectionId}/tiles/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 14,
      })

      applyMapStyle(map, layerName, geometryType, style ?? null)

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
  }, [collectionId, bbox, geometryType, layerName, style])

  return (
    <div className="relative">
      <div ref={mapContainer} className="w-full h-[600px] rounded-lg border border-gray-200" />
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

function SchemaView({ layerId }: { layerId: string }) {
  const [columns, setColumns] = useState<ColumnSchema[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.layers
      .schema(layerId)
      .then((data) => {
        setColumns(data.columns)
        setTotalCount(data.total_count)
      })
      .finally(() => setLoading(false))
  }, [layerId])

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

function SettingsView({ layer, onUpdate }: { layer: Layer; onUpdate: (l: Layer) => void }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [columns, setColumns] = useState<ColumnSchema[]>([])
  const [workspaceId, setWorkspaceId] = useState(layer.workspace_id)
  const [description, setDescription] = useState(layer.description ?? '')
  const [attribution, setAttribution] = useState(layer.attribution ?? '')
  const [datetimeColumn, setDatetimeColumn] = useState(layer.datetime_column ?? '')
  const [fields, setFields] = useState<FieldConfig[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.workspaces.list().then(setWorkspaces)
    api.layers.schema(layer.id).then((data) => {
      setColumns(data.columns)
      // Build field config from schema + existing exposed_fields
      const dataCols = data.columns.filter(
        (c) => c.column !== layer.geometry_column && c.column !== layer.id_column,
      )
      const exposed = layer.exposed_fields
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
  }, [layer.id, layer.geometry_column, layer.id_column, layer.exposed_fields])

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

      const updated = await api.layers.update(layer.id, {
        workspace_id: workspaceId !== layer.workspace_id ? workspaceId : undefined,
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
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl space-y-5"
    >
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
          placeholder="A short description of this layer"
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
        <label className="block text-sm font-medium text-gray-700 mb-1">Datetime column</label>
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
          Enables the OGC <code>?datetime=</code> filter on this layer
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Exposed fields</label>
        <p className="text-xs text-gray-400 mb-3">
          Choose which columns are exposed in the API. Uncheck a column to hide it. Set an alias to
          rename it in the API response.
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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved successfully</span>}
      </div>
    </form>
  )
}

function StyleView({ layer, onUpdate }: { layer: Layer; onUpdate: (l: Layer) => void }) {
  const [columns, setColumns] = useState<ColumnSchema[]>([])
  const [styleType, setStyleType] = useState<'single' | 'categorized' | 'graduated'>(
    layer.style?.type ?? 'single',
  )
  const [fillColor, setFillColor] = useState(layer.style?.fill_color ?? '#1B4F72')
  const [fillOpacity, setFillOpacity] = useState(layer.style?.fill_opacity ?? 0.3)
  const [strokeWidth] = useState(layer.style?.stroke_width ?? 1.5)
  const [field, setField] = useState(layer.style?.field ?? '')
  const [categories, setCategories] = useState(layer.style?.categories ?? [])
  const [method, setMethod] = useState<'equal_interval' | 'quantile'>(
    (layer.style?.method as 'equal_interval' | 'quantile') ?? 'quantile',
  )
  const [numClasses, setNumClasses] = useState(layer.style?.classes?.length ?? 5)
  const [classes, setClasses] = useState(layer.style?.classes ?? [])
  const [palette, setPalette] = useState<PaletteName>('blues')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [classifyLoading, setClassifyLoading] = useState(false)

  const [hasStyle, setHasStyle] = useState(layer.style != null)

  // Live preview style — null when no style is active
  const previewStyle = hasStyle ? buildPreviewStyle() : null

  useEffect(() => {
    api.layers.schema(layer.id).then((data) => {
      setColumns(
        data.columns.filter(
          (c) => c.column !== layer.geometry_column && c.column !== layer.id_column,
        ),
      )
    })
  }, [layer.id, layer.geometry_column, layer.id_column])

  const numericColumns = columns.filter((c) =>
    ['integer', 'bigint', 'smallint', 'double precision', 'real', 'numeric'].includes(c.type),
  )

  function buildPreviewStyle(): StyleConfig {
    if (styleType === 'single') {
      return {
        type: 'single',
        fill_color: fillColor,
        fill_opacity: fillOpacity,
        stroke_width: strokeWidth,
      }
    }
    if (styleType === 'categorized') {
      return {
        type: 'categorized',
        field,
        categories,
        fill_opacity: fillOpacity,
        stroke_width: strokeWidth,
        default_color: '#cccccc',
      }
    }
    return {
      type: 'graduated',
      field,
      method,
      classes,
      fill_opacity: fillOpacity,
      stroke_width: strokeWidth,
      default_color: '#cccccc',
    }
  }

  async function handleClassify() {
    if (!field) return
    setClassifyLoading(true)
    setError('')
    try {
      const result: ClassifyResult = await api.layers.classify(layer.id, {
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
      const updated = await api.layers.update(layer.id, { style: styleToSave })
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
      const updated = await api.layers.update(layer.id, { style: null })
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

  const collectionId = `${layer.workspace_name}:${layer.name}`

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
            className="bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save style'}
          </button>
          {hasStyle && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={saving}
              className="px-4 py-2 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Remove style
            </button>
          )}
          {saved && <span className="text-sm text-green-600">Saved successfully</span>}
        </div>
      </div>

      <div>
        <MapView
          collectionId={collectionId}
          bbox={layer.bbox}
          geometryType={layer.geometry_type}
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

function HistoryView({ layerId }: { layerId: string }) {
  const [history, setHistory] = useState<ImportHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const data = await api.layers.history(layerId)
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
  }, [layerId])

  if (loading) return <div className="animate-pulse h-48 bg-gray-200 rounded-lg" />

  if (history.length === 0) {
    return <p className="text-sm text-gray-500">No import history for this layer.</p>
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

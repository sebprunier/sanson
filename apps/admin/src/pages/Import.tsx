import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../services/api'
import type { Workspace, ImportAccepted, JobStatus, PreviewResult } from '../services/api'
import { basemapStyle } from '../utils/basemaps'

export function Import() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [collectionName, setCollectionName] = useState('')
  const [srid, setSrid] = useState('4326')
  const [file, setFile] = useState<File | null>(null)
  const [isCsv, setIsCsv] = useState(false)
  const [isShapefile, setIsShapefile] = useState(false)
  const [separator, setSeparator] = useState('')
  const [longitudeCol, setLongitudeCol] = useState('')
  const [latitudeCol, setLatitudeCol] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportAccepted | null>(null)
  const [currentJob, setCurrentJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  // History state
  const [jobs, setJobs] = useState<JobStatus[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    api.workspaces.list().then((ws) => {
      setWorkspaces(ws)
      if (ws.length > 0) {
        const defaultWs = ws.find((w) => w.name === 'default')
        setWorkspaceId(defaultWs?.id ?? ws[0].id)
      }
    })
  }, [])

  // Poll current job status
  useEffect(() => {
    if (!importResult) return
    let cancelled = false

    const poll = async () => {
      try {
        const status = await api.jobs.get(importResult.import_id)
        if (cancelled) return
        setCurrentJob(status)
        if (status.status === 'pending' || status.status === 'running') {
          setTimeout(poll, 2000)
        } else {
          // Job finished — refresh history
          loadJobs()
        }
      } catch {
        if (!cancelled) setTimeout(poll, 2000)
      }
    }

    poll()
    return () => {
      cancelled = true
    }
  }, [importResult])

  // Load jobs history
  const loadJobs = async () => {
    const params = statusFilter ? { status: statusFilter } : undefined
    const data = await api.jobs.list(params)
    setJobs(data)
    setJobsLoading(false)
  }

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const params = statusFilter ? { status: statusFilter } : undefined
      const data = await api.jobs.list(params)
      if (cancelled) return
      setJobs(data)
      setJobsLoading(false)

      if (data.some((j) => j.status === 'pending' || j.status === 'running')) {
        setTimeout(load, 2000)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [statusFilter])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    const csv = f.name.toLowerCase().endsWith('.csv')
    const shp = f.name.toLowerCase().endsWith('.zip')
    setIsCsv(csv)
    setIsShapefile(shp)

    // Reset form fields for the new file
    setCollectionName(
      f.name
        .replace(/\.geojson\.gz$/, '')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase(),
    )
    setSrid('4326')
    setSeparator('')
    setLongitudeCol('')
    setLatitudeCol('')
    setError('')

    // Trigger preview
    setPreview(null)
    setPreviewError('')
    setPreviewLoading(true)
    try {
      const result = await api.preview(f)
      setPreview(result)
      // Auto-fill form fields from preview
      if (result.csv_info) {
        if (result.csv_info.separator) setSeparator(result.csv_info.separator)
        if (result.csv_info.longitude_column) setLongitudeCol(result.csv_info.longitude_column)
        if (result.csv_info.latitude_column) setLatitudeCol(result.csv_info.latitude_column)
      }
      if (result.srid) setSrid(String(result.srid))
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !workspaceId || !collectionName) return

    setImporting(true)
    setError('')
    setImportResult(null)
    setCurrentJob(null)

    try {
      const res = await api.import({
        workspace_id: workspaceId,
        collection_name: collectionName,
        file,
        srid: parseInt(srid) || undefined,
        separator: isCsv && separator ? separator : undefined,
        longitude: isCsv && longitudeCol ? longitudeCol : undefined,
        latitude: isCsv && latitudeCol ? latitudeCol : undefined,
      })
      setImportResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleReset = () => {
    setImportResult(null)
    setCurrentJob(null)
    setFile(null)
    setIsCsv(false)
    setIsShapefile(false)
    setSeparator('')
    setLongitudeCol('')
    setLatitudeCol('')
    setCollectionName('')
    setError('')
    setPreview(null)
    setPreviewLoading(false)
    setPreviewError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Import</h1>

      {/* Current import progress */}
      {importResult ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span
              className={`w-3 h-3 rounded-full ${
                currentJob?.status === 'completed'
                  ? 'bg-green-500'
                  : currentJob?.status === 'failed'
                    ? 'bg-red-500'
                    : 'bg-yellow-500 animate-pulse'
              }`}
            />
            <span
              className={`font-medium ${
                currentJob?.status === 'completed'
                  ? 'text-green-700'
                  : currentJob?.status === 'failed'
                    ? 'text-red-700'
                    : 'text-yellow-700'
              }`}
            >
              {currentJob?.status === 'completed'
                ? 'Import complete'
                : currentJob?.status === 'failed'
                  ? 'Import failed'
                  : currentJob?.status === 'running'
                    ? 'Importing...'
                    : 'Queued...'}
            </span>
          </div>

          {currentJob && (currentJob.status === 'running' || currentJob.status === 'completed') && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>{currentJob.progress}%</span>
                <span>
                  {currentJob.imported_features?.toLocaleString() ?? 0} /{' '}
                  {currentJob.total_features?.toLocaleString() ?? '?'} features
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all duration-300 ${
                    currentJob.status === 'completed' ? 'bg-green-500' : 'bg-primary-600'
                  }`}
                  style={{ width: `${currentJob.progress}%` }}
                />
              </div>
            </div>
          )}

          {currentJob?.status === 'failed' && currentJob.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
              {currentJob.error}
            </div>
          )}

          {currentJob?.status === 'completed' && (
            <dl className="space-y-2 text-sm mb-4">
              <Row
                label="Features"
                value={String(currentJob.feature_count ?? currentJob.imported_features)}
              />
              {currentJob.duration_ms != null && (
                <Row label="Duration" value={`${(currentJob.duration_ms / 1000).toFixed(1)}s`} />
              )}
              {currentJob.collection_name && (
                <Row label="Collection" value={currentJob.collection_name} />
              )}
            </dl>
          )}

          {currentJob?.logs && currentJob.logs.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Logs</p>
              <div className="bg-gray-900 rounded-lg p-3 max-h-48 overflow-auto">
                {currentJob.logs.map((log, i) => (
                  <div key={i} className="text-xs font-mono leading-5">
                    <span className="text-gray-500">{new Date(log.ts).toLocaleTimeString()}</span>{' '}
                    <span className={log.level === 'error' ? 'text-red-400' : 'text-green-400'}>
                      {log.level}
                    </span>{' '}
                    <span className="text-gray-300">{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(currentJob?.status === 'completed' || currentJob?.status === 'failed') && (
            <div className="flex gap-3 mt-6">
              {currentJob.status === 'completed' && currentJob.collection_id && (
                <button
                  onClick={() => navigate(`/collections/${currentJob.collection_id}`)}
                  className="bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800"
                >
                  View collection
                </button>
              )}
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Import another
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Upload form + preview */
        <div
          className={`mb-8 ${preview || previewLoading || previewError ? 'flex flex-col lg:flex-row' : ''}`}
        >
          <form
            onSubmit={handleSubmit}
            className={`bg-white rounded-lg border border-gray-200 p-6 space-y-5 max-w-lg ${preview || previewLoading || previewError ? 'lg:rounded-r-none lg:border-r-0 shrink-0' : ''}`}
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data file</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".geojson,.json,.geojson.gz,.gz,.csv,.zip"
                onChange={handleFileChange}
                required
                className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              />
              <p className="text-xs text-gray-400 mt-1">
                GeoJSON, GeoJSON.gz, CSV, or Shapefile (.zip)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Workspace</label>
              <select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                required
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Collection name
              </label>
              <input
                type="text"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                required
                placeholder="e.g. nuclear_plants"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SRID</label>
              <input
                type="text"
                value={srid}
                onChange={(e) => setSrid(e.target.value)}
                placeholder="4326"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                {isShapefile
                  ? 'Target storage SRID. Source SRID is auto-detected from .prj file.'
                  : 'Default: 4326 (WGS84)'}
              </p>
            </div>

            {isCsv && !isShapefile && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Separator</label>
                  <input
                    type="text"
                    value={separator}
                    onChange={(e) => setSeparator(e.target.value)}
                    placeholder="Auto-detect"
                    maxLength={1}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Leave empty for auto-detection</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Longitude column
                    </label>
                    <input
                      type="text"
                      value={longitudeCol}
                      onChange={(e) => setLongitudeCol(e.target.value)}
                      placeholder="Auto-detect"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Latitude column
                    </label>
                    <input
                      type="text"
                      value={latitudeCol}
                      onChange={(e) => setLatitudeCol(e.target.value)}
                      placeholder="Auto-detect"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 -mt-3">
                  Leave empty to auto-detect common names (longitude/lon/x, latitude/lat/y, etc.)
                </p>
              </>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={importing || !file}
              className="w-full inline-flex items-center justify-center gap-1.5 bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                />
              </svg>
              {importing ? 'Submitting...' : 'Import'}
            </button>
          </form>

          {/* Preview panel */}
          {(preview || previewLoading || previewError) && (
            <div className="bg-white rounded-lg lg:rounded-l-none border border-gray-200 lg:border-l-0 p-6 min-w-0 flex-1">
              {previewLoading ? (
                <PreviewSkeleton />
              ) : previewError ? (
                <div className="text-sm">
                  <h3 className="font-semibold text-gray-900 mb-3">Preview</h3>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">
                    {previewError}
                  </div>
                </div>
              ) : preview ? (
                <FilePreview preview={preview} />
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Import history */}
      <h2 className="text-lg font-semibold text-gray-900 mb-4">History</h2>

      <div className="flex gap-2 mb-4">
        {['', 'pending', 'running', 'completed', 'failed'].map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatusFilter(s)
              setJobsLoading(true)
            }}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              statusFilter === s
                ? 'bg-primary-700 text-white border-primary-700'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {jobsLoading ? (
        <div className="animate-pulse h-32 bg-gray-200 rounded-lg" />
      ) : jobs.length === 0 ? (
        <p className="text-sm text-gray-500">No imports yet.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200">
                <th className="text-left px-3 py-2 font-medium text-gray-600">Date</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Source</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Collection</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Progress</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Features</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Duration</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr
                  key={j.id}
                  className={`border-b border-gray-100 last:border-0 ${
                    j.collection_id ? 'hover:bg-gray-50 cursor-pointer' : ''
                  }`}
                  onClick={() => j.collection_id && navigate(`/collections/${j.collection_id}`)}
                >
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                    {new Date(j.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{j.source_file}</td>
                  <td className="px-3 py-2 text-gray-700">{j.collection_name ?? '—'}</td>
                  <td className="px-3 py-2 w-32">
                    {j.status === 'running' || j.status === 'pending' ? (
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-primary-600 h-1.5 rounded-full transition-all"
                          style={{ width: `${j.progress}%` }}
                        />
                      </div>
                    ) : j.status === 'completed' ? (
                      <span className="text-gray-500">100%</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {j.status === 'running'
                      ? `${j.imported_features?.toLocaleString() ?? 0} / ${j.total_features?.toLocaleString() ?? '?'}`
                      : (j.feature_count?.toLocaleString() ?? '—')}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {j.duration_ms != null ? `${(j.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        j.status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : j.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : j.status === 'running'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {j.status}
                    </span>
                    {j.error && <p className="text-xs text-red-600 mt-1">{j.error}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 font-medium">{value}</dd>
    </div>
  )
}

function FilePreview({ preview }: { preview: PreviewResult }) {
  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-gray-900">Preview</h3>
      <MetadataBadges preview={preview} />
      {preview.sample_geojson && preview.sample_geojson.features.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">
            Map preview (first {preview.sample_geojson.features.length} feature
            {preview.sample_geojson.features.length !== 1 ? 's' : ''})
          </p>
          <PreviewMap geojson={preview.sample_geojson} bbox={preview.bbox} />
        </div>
      )}
      {preview.sample_rows.length > 0 && (
        <SampleTable fields={preview.fields} rows={preview.sample_rows} />
      )}
    </div>
  )
}

function MetadataBadges({ preview }: { preview: PreviewResult }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge label={preview.format.toUpperCase()} />
      {preview.feature_count != null && (
        <Badge label={`${preview.feature_count.toLocaleString()} features`} />
      )}
      {preview.geometry_type && <Badge label={preview.geometry_type} />}
      {preview.srid && <Badge label={`EPSG:${preview.srid}`} />}
      {preview.csv_info?.separator && (
        <Badge
          label={`sep: "${preview.csv_info.separator === '\t' ? 'TAB' : preview.csv_info.separator}"`}
        />
      )}
      {preview.csv_info?.longitude_column && preview.csv_info?.latitude_column && (
        <Badge
          label={`geo: ${preview.csv_info.longitude_column}, ${preview.csv_info.latitude_column}`}
        />
      )}
    </div>
  )
}

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
      {label}
    </span>
  )
}

function PreviewMap({
  geojson,
  bbox,
}: {
  geojson: { type: 'FeatureCollection'; features: Array<object> }
  bbox: [number, number, number, number] | null
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        ...basemapStyle('light'),
      },
      center: [2.3, 46.8],
      zoom: 5,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource('preview', {
        type: 'geojson',
        data: geojson as GeoJSON.FeatureCollection,
      })

      map.addLayer({
        id: 'preview-fill',
        type: 'fill',
        source: 'preview',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.3 },
      })
      map.addLayer({
        id: 'preview-line',
        type: 'line',
        source: 'preview',
        filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
        paint: { 'line-color': '#3b82f6', 'line-width': 2 },
      })
      map.addLayer({
        id: 'preview-circle',
        type: 'circle',
        source: 'preview',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#3b82f6',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
        },
      })

      if (bbox) {
        map.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          { padding: 50 },
        )
      }
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [geojson, bbox])

  return <div ref={mapContainer} className="w-full h-[300px] rounded-lg border border-gray-200" />
}

function SampleTable({
  fields,
  rows,
}: {
  fields: Array<{ name: string; type: string }>
  rows: Array<Record<string, unknown>>
}) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-2">
        Sample data ({rows.length} row{rows.length !== 1 ? 's' : ''})
      </p>
      <div className="overflow-auto max-h-64 rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {fields.map((f) => (
                <th
                  key={f.name}
                  className="text-left px-2 py-1.5 font-medium text-gray-600 whitespace-nowrap"
                >
                  {f.name}
                  <span className="text-gray-400 ml-1 font-normal">{f.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100">
                {fields.map((f) => (
                  <td
                    key={f.name}
                    className="px-2 py-1.5 text-gray-700 whitespace-nowrap max-w-[200px] truncate"
                  >
                    {row[f.name] != null ? String(row[f.name]) : '\u2014'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 w-24 bg-gray-200 rounded" />
      <div className="flex gap-2">
        <div className="h-5 w-16 bg-gray-200 rounded-full" />
        <div className="h-5 w-24 bg-gray-200 rounded-full" />
        <div className="h-5 w-20 bg-gray-200 rounded-full" />
      </div>
      <div className="h-[300px] bg-gray-200 rounded-lg" />
      <div className="h-32 bg-gray-200 rounded" />
    </div>
  )
}

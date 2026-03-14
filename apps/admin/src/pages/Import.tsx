import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import type { Workspace, ImportAccepted, JobStatus } from '../services/api'

export function Import() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [layerName, setLayerName] = useState('')
  const [srid, setSrid] = useState('4326')
  const [file, setFile] = useState<File | null>(null)
  const [isCsv, setIsCsv] = useState(false)
  const [separator, setSeparator] = useState('')
  const [longitudeCol, setLongitudeCol] = useState('')
  const [latitudeCol, setLatitudeCol] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportAccepted | null>(null)
  const [currentJob, setCurrentJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState('')

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    const csv = f.name.toLowerCase().endsWith('.csv')
    setIsCsv(csv)
    if (!layerName) {
      setLayerName(
        f.name
          .replace(/\.geojson\.gz$/, '')
          .replace(/\.[^.]+$/, '')
          .replace(/[^a-zA-Z0-9_]/g, '_')
          .toLowerCase(),
      )
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !workspaceId || !layerName) return

    setImporting(true)
    setError('')
    setImportResult(null)
    setCurrentJob(null)

    try {
      const res = await api.import({
        workspace_id: workspaceId,
        layer_name: layerName,
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
    setSeparator('')
    setLongitudeCol('')
    setLatitudeCol('')
    setLayerName('')
    setError('')
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
              {currentJob.layer_name && <Row label="Layer" value={currentJob.layer_name} />}
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
              {currentJob.status === 'completed' && currentJob.layer_id && (
                <button
                  onClick={() => navigate(`/layers/${currentJob.layer_id}`)}
                  className="bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800"
                >
                  View layer
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
        /* Upload form */
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg space-y-5 mb-8"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data file</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".geojson,.json,.geojson.gz,.gz,.csv"
              onChange={handleFileChange}
              required
              className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
            />
            <p className="text-xs text-gray-400 mt-1">GeoJSON, GeoJSON.gz, or CSV</p>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Layer name</label>
            <input
              type="text"
              value={layerName}
              onChange={(e) => setLayerName(e.target.value)}
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
            <p className="text-xs text-gray-400 mt-1">Default: 4326 (WGS84)</p>
          </div>

          {isCsv && (
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
            className="w-full bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-800 disabled:opacity-50 transition-colors"
          >
            {importing ? 'Submitting...' : 'Import'}
          </button>
        </form>
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
                <th className="text-left px-3 py-2 font-medium text-gray-600">Layer</th>
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
                    j.layer_id ? 'hover:bg-gray-50 cursor-pointer' : ''
                  }`}
                  onClick={() => j.layer_id && navigate(`/layers/${j.layer_id}`)}
                >
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                    {new Date(j.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{j.source_file}</td>
                  <td className="px-3 py-2 text-gray-700">{j.layer_name ?? '—'}</td>
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

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
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportAccepted | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.workspaces.list().then((ws) => {
      setWorkspaces(ws)
      if (ws.length > 0) {
        const defaultWs = ws.find((w) => w.name === 'default')
        setWorkspaceId(defaultWs?.id ?? ws[0].id)
      }
    })
  }, [])

  // Poll job status when we have an import_id
  useEffect(() => {
    if (!importResult) return
    let cancelled = false

    const poll = async () => {
      try {
        const status = await api.jobs.get(importResult.import_id)
        if (cancelled) return
        setJob(status)
        if (status.status === 'pending' || status.status === 'running') {
          setTimeout(poll, 2000)
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!layerName) {
      setLayerName(
        f.name
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
    setJob(null)

    try {
      const res = await api.import({
        workspace_id: workspaceId,
        layer_name: layerName,
        file,
        srid: parseInt(srid) || undefined,
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
    setJob(null)
    setFile(null)
    setLayerName('')
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Progress view
  if (importResult) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Import</h1>
        <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
          {/* Status badge */}
          <div className="flex items-center gap-2 mb-4">
            <span
              className={`w-3 h-3 rounded-full ${
                job?.status === 'completed'
                  ? 'bg-green-500'
                  : job?.status === 'failed'
                    ? 'bg-red-500'
                    : 'bg-yellow-500 animate-pulse'
              }`}
            />
            <span
              className={`font-medium ${
                job?.status === 'completed'
                  ? 'text-green-700'
                  : job?.status === 'failed'
                    ? 'text-red-700'
                    : 'text-yellow-700'
              }`}
            >
              {job?.status === 'completed'
                ? 'Import complete'
                : job?.status === 'failed'
                  ? 'Import failed'
                  : job?.status === 'running'
                    ? 'Importing...'
                    : 'Queued...'}
            </span>
          </div>

          {/* Progress bar */}
          {job && (job.status === 'running' || job.status === 'completed') && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>{job.progress}%</span>
                <span>
                  {job.imported_features?.toLocaleString() ?? 0} /{' '}
                  {job.total_features?.toLocaleString() ?? '?'} features
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all duration-300 ${
                    job.status === 'completed' ? 'bg-green-500' : 'bg-primary-600'
                  }`}
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {job?.status === 'failed' && job.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
              {job.error}
            </div>
          )}

          {/* Completed info */}
          {job?.status === 'completed' && (
            <dl className="space-y-2 text-sm mb-4">
              <Row label="Features" value={String(job.feature_count ?? job.imported_features)} />
              {job.duration_ms != null && (
                <Row label="Duration" value={`${(job.duration_ms / 1000).toFixed(1)}s`} />
              )}
              {job.layer_name && <Row label="Layer" value={job.layer_name} />}
            </dl>
          )}

          {/* Logs */}
          {job?.logs && job.logs.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Logs</p>
              <div className="bg-gray-900 rounded-lg p-3 max-h-48 overflow-auto">
                {job.logs.map((log, i) => (
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

          {/* Actions */}
          {(job?.status === 'completed' || job?.status === 'failed') && (
            <div className="flex gap-3 mt-6">
              {job.status === 'completed' && (
                <button
                  onClick={() => navigate('/layers')}
                  className="bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800"
                >
                  View layers
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
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Import data</h1>
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">GeoJSON file</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json"
            onChange={handleFileChange}
            required
            className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
          />
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

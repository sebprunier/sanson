import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import type { Workspace, ImportResult } from '../services/api'

export function Import() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [layerName, setLayerName] = useState('')
  const [srid, setSrid] = useState('4326')
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
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
    setResult(null)

    try {
      const res = await api.import({
        workspace_id: workspaceId,
        layer_name: layerName,
        file,
        srid: parseInt(srid) || undefined,
      })
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  if (result) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Import successful</h1>
        <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-green-700 font-medium">Import complete</span>
          </div>
          <dl className="space-y-3 text-sm">
            <Row label="Collection" value={result.collection_id} />
            <Row label="Features" value={result.feature_count.toLocaleString()} />
            <Row label="Geometry" value={result.geometry_type} />
            <Row label="SRID" value={String(result.srid)} />
            <Row label="Table" value={result.table_name} />
            {result.bbox && (
              <Row label="Bbox" value={result.bbox.map((n) => n.toFixed(4)).join(', ')} />
            )}
          </dl>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => navigate('/layers')}
              className="bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800"
            >
              View layers
            </button>
            <button
              onClick={() => {
                setResult(null)
                setFile(null)
                setLayerName('')
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Import another
            </button>
          </div>
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
          {importing ? 'Importing...' : 'Import'}
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

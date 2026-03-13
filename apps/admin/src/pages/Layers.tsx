import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { api } from '../services/api'
import type { Layer, Workspace } from '../services/api'

export function Layers() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [layers, setLayers] = useState<Layer[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  const selectedWorkspace = searchParams.get('workspace') ?? ''

  const load = () => {
    setLoading(true)
    Promise.all([api.layers.list(selectedWorkspace || undefined), api.workspaces.list()]).then(
      ([ly, ws]) => {
        setLayers(ly)
        setWorkspaces(ws)
        setLoading(false)
      },
    )
  }

  useEffect(load, [selectedWorkspace])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete layer "${name}"? This cannot be undone.`)) return
    await api.layers.delete(id)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Layers</h1>
        <Link
          to="/import"
          className="bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors"
        >
          Import data
        </Link>
      </div>

      <div className="mb-4">
        <select
          value={selectedWorkspace}
          onChange={(e) => {
            if (e.target.value) setSearchParams({ workspace: e.target.value })
            else setSearchParams({})
          }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All workspaces</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-lg" />
          ))}
        </div>
      ) : layers.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-2">No layers found.</p>
          <Link to="/import" className="text-primary-600 hover:text-primary-800">
            Import some data
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Workspace</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Geometry</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">SRID</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Features</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {layers.map((layer) => (
                <tr key={layer.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      to={`/layers/${layer.id}`}
                      className="font-medium text-primary-700 hover:text-primary-900"
                    >
                      {layer.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{layer.workspace_name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block bg-primary-50 text-primary-700 text-xs px-2 py-0.5 rounded">
                      {layer.geometry_type ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{layer.srid}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {layer.feature_count?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(layer.id, layer.name)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      Delete
                    </button>
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

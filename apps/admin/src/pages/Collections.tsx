import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { api } from '../services/api'
import type { Collection, Workspace } from '../services/api'

export function Collections() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [collections, setCollections] = useState<Collection[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  const selectedWorkspace = searchParams.get('workspace') ?? ''

  const load = () => {
    setLoading(true)
    Promise.all([api.collections.list(selectedWorkspace || undefined), api.workspaces.list()]).then(
      ([cols, ws]) => {
        setCollections(cols)
        setWorkspaces(ws)
        setLoading(false)
      },
    )
  }

  useEffect(load, [selectedWorkspace])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete collection "${name}"? This cannot be undone.`)) return
    await api.collections.delete(id)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Collections</h1>
        <Link
          to="/import"
          className="inline-flex items-center gap-1.5 bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors"
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
      ) : collections.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-2">No collections found.</p>
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
              {collections.map((col) => (
                <tr key={col.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      to={`/collections/${col.id}`}
                      className="font-medium text-primary-700 hover:text-primary-900"
                    >
                      {col.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{col.workspace_name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block bg-primary-50 text-primary-700 text-xs px-2 py-0.5 rounded">
                      {col.geometry_type ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{col.srid}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {col.feature_count?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(col.id, col.name)}
                      className="inline-flex items-center gap-1 text-red-500 hover:text-red-700 text-sm"
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

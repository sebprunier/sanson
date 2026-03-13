import { useEffect, useState } from 'react'
import { api } from '../services/api'
import type { Workspace, Layer, HealthStatus } from '../services/api'

export function Dashboard() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [layers, setLayers] = useState<Layer[]>([])
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.workspaces.list(),
      api.layers.list(),
      api.health().catch(() => ({ status: 'error', db: 'error' })),
    ]).then(([ws, ly, h]) => {
      setWorkspaces(ws)
      setLayers(ly)
      setHealth(h)
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSkeleton />

  const totalFeatures = layers.reduce((sum, l) => sum + (l.feature_count ?? 0), 0)
  const dbOk = health?.db === 'ok' || health?.db === 'connected'

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <StatCard label="Workspaces" value={workspaces.length} color="primary" />
        <StatCard label="Layers" value={layers.length} color="primary" />
        <StatCard label="Features" value={totalFeatures.toLocaleString()} color="primary" />
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Database</p>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dbOk ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={`text-lg font-semibold ${dbOk ? 'text-green-700' : 'text-red-700'}`}>
              {dbOk ? 'Connected' : 'Error'}
            </span>
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent layers</h2>
      {layers.length === 0 ? (
        <p className="text-gray-500">No layers yet. Import some data to get started.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Workspace</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Geometry</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Features</th>
              </tr>
            </thead>
            <tbody>
              {layers.slice(0, 10).map((layer) => (
                <tr key={layer.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{layer.name}</td>
                  <td className="px-4 py-3 text-gray-600">{layer.workspace_name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block bg-primary-50 text-primary-700 text-xs px-2 py-0.5 rounded">
                      {layer.geometry_type ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {layer.feature_count?.toLocaleString() ?? '—'}
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

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: string
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold text-${color}-700`}>{value}</p>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-40 bg-gray-200 rounded mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-200 rounded-lg" />
        ))}
      </div>
      <div className="h-6 w-32 bg-gray-200 rounded mb-4" />
      <div className="h-48 bg-gray-200 rounded-lg" />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { api } from '../services/api'
import type { DetailedHealth } from '../services/api'

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
    />
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}

export function Health() {
  const [health, setHealth] = useState<DetailedHealth | null>(null)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchHealth = () => {
    api
      .detailedHealth()
      .then((data) => {
        setHealth(data)
        setError('')
        setLastRefresh(new Date())
      })
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30_000)
    return () => clearInterval(interval)
  }, [])

  if (error && !health) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Health</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
      </div>
    )
  }

  if (!health) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Health</h1>
        <div className="animate-pulse space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  const dbOk = health.database.status === 'ok'
  const totalJobs =
    health.jobs.pending + health.jobs.running + health.jobs.completed + health.jobs.failed

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Health</h1>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-gray-400">
              Last refresh: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchHealth}
            className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 font-medium"
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
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Server */}
        <Card title="Server">
          <Row label="Version" value={`Sanson v${health.server.version}`} />
          <Row label="Node.js" value={health.server.node_version} />
          <Row label="Mode" value={health.server.node_mode} />
          <Row label="Uptime" value={formatUptime(health.server.uptime_seconds)} />
          <Row label="Memory (RSS)" value={`${health.server.memory.rss_mb} MB`} />
          <Row
            label="Heap"
            value={`${health.server.memory.heap_used_mb} / ${health.server.memory.heap_total_mb} MB`}
          />
        </Card>

        {/* Database */}
        <Card title="Database">
          <Row
            label="Status"
            value={
              <span className="flex items-center gap-2">
                <StatusDot ok={dbOk} />
                {dbOk ? 'Connected' : 'Error'}
              </span>
            }
          />
          {dbOk ? (
            <>
              <Row label="PostgreSQL" value={health.database.postgresql_version ?? '—'} />
              <Row label="PostGIS" value={health.database.postgis_version ?? '—'} />
              <Row label="Database size" value={health.database.database_size ?? '—'} />
              <Row
                label="Connections"
                value={`${health.database.connections?.active ?? '—'} / ${health.database.connections?.max ?? '—'}`}
              />
            </>
          ) : (
            <div className="mt-2 text-sm text-red-600">{health.database.error}</div>
          )}
        </Card>

        {/* Jobs */}
        <Card title="Jobs">
          <Row label="Total" value={totalJobs} />
          <Row
            label="Pending"
            value={
              <span className={health.jobs.pending > 0 ? 'text-amber-600' : ''}>
                {health.jobs.pending}
              </span>
            }
          />
          <Row
            label="Running"
            value={
              <span className={health.jobs.running > 0 ? 'text-blue-600' : ''}>
                {health.jobs.running}
              </span>
            }
          />
          <Row label="Completed" value={health.jobs.completed} />
          <Row
            label="Failed"
            value={
              <span className={health.jobs.failed > 0 ? 'text-red-600 font-semibold' : ''}>
                {health.jobs.failed}
              </span>
            }
          />
          {health.jobs.last_completed && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1">Last completed job</p>
              <p className="text-sm text-gray-700">{health.jobs.last_completed.source_file}</p>
              <p className="text-xs text-gray-400">
                {new Date(health.jobs.last_completed.completed_at).toLocaleString()}
                {health.jobs.last_completed.duration_ms != null &&
                  ` — ${(health.jobs.last_completed.duration_ms / 1000).toFixed(1)}s`}
              </p>
            </div>
          )}
        </Card>

        {/* Dependencies */}
        <Card title="Dependencies">
          <Row
            label="GDAL / ogr2ogr"
            value={
              <span className="flex items-center gap-2">
                <StatusDot ok={health.gdal.available} />
                {health.gdal.available ? 'Available' : 'Not found'}
              </span>
            }
          />
          {health.gdal.version && <Row label="Version" value={health.gdal.version} />}
        </Card>
      </div>
    </div>
  )
}

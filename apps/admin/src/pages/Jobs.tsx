import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import type { JobStatus } from '../services/api'

export function Jobs() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<JobStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const params = statusFilter ? { status: statusFilter } : undefined
      const data = await api.jobs.list(params)
      if (cancelled) return
      setJobs(data)
      setLoading(false)

      if (data.some((j) => j.status === 'pending' || j.status === 'running')) {
        setTimeout(load, 2000)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [statusFilter])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Jobs</h1>

      <div className="flex gap-2 mb-4">
        {['', 'pending', 'running', 'completed', 'failed'].map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatusFilter(s)
              setLoading(true)
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

      {loading ? (
        <div className="animate-pulse h-48 bg-gray-200 rounded-lg" />
      ) : jobs.length === 0 ? (
        <p className="text-sm text-gray-500">No jobs found.</p>
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
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
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

import { useEffect, useState } from 'react'
import { api } from '../services/api'
import type { ConfigEntry } from '../services/api'

const CATEGORY_LABELS: Record<string, string> = {
  upload: 'Upload',
  import: 'Import',
  jobs: 'Job Queue (pg-boss)',
  tiles: 'Vector Tiles',
}

const CATEGORY_ORDER = ['upload', 'import', 'jobs', 'tiles']

export function Configuration() {
  const [entries, setEntries] = useState<ConfigEntry[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.config
      .list()
      .then((data) => {
        setEntries(data)
        setValues(Object.fromEntries(data.map((e) => [e.key, e.value])))
      })
      .catch((err) => setError(err.message))
  }, [])

  const hasChanges = entries.some((e) => values[e.key] !== e.value)

  const handleSave = async () => {
    const updates = entries
      .filter((e) => values[e.key] !== e.value)
      .map((e) => ({ key: e.key, value: values[e.key] }))

    if (updates.length === 0) return

    setSaving(true)
    setSaved(false)
    try {
      const updated = await api.config.update(updates)
      setEntries(updated)
      setValues(Object.fromEntries(updated.map((e) => [e.key, e.value])))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setValues(Object.fromEntries(entries.map((e) => [e.key, e.value])))
  }

  const needsRestart = entries.some((e) => values[e.key] !== e.value && e.restart)

  if (error && entries.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Configuration</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Configuration</h1>
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    items: entries.filter((e) => e.category === cat),
  })).filter((g) => g.items.length > 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configuration</h1>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
          {hasChanges && (
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 font-medium"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              hasChanges && !saving
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      {needsRestart && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-700 text-sm">
          Some changed settings require a server restart to take effect.
        </div>
      )}

      <div className="space-y-5">
        {grouped.map((group) => (
          <div key={group.category} className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              {group.label}
            </h2>
            <div className="space-y-4">
              {group.items.map((entry) => (
                <div key={entry.key} className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <label htmlFor={entry.key} className="block text-sm font-medium text-gray-900">
                      {entry.label}
                      {entry.restart && (
                        <span className="ml-2 text-xs text-amber-600 font-normal">
                          restart required
                        </span>
                      )}
                    </label>
                    {entry.description && (
                      <p className="text-xs text-gray-400 mt-0.5">{entry.description}</p>
                    )}
                  </div>
                  <input
                    id={entry.key}
                    type="number"
                    value={values[entry.key] ?? ''}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [entry.key]: e.target.value }))
                    }
                    className={`w-32 px-3 py-1.5 border rounded-md text-sm text-right ${
                      values[entry.key] !== entry.value
                        ? 'border-primary-400 bg-primary-50'
                        : 'border-gray-300'
                    }`}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

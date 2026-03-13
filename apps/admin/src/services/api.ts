export interface Workspace {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface Layer {
  id: string
  workspace_id: string
  workspace_name: string
  name: string
  description: string | null
  table_name: string
  geometry_column: string
  geometry_type: string | null
  id_column: string
  srid: number
  bbox: string | null
  feature_count: number | null
  created_at: string
  updated_at: string
}

export interface HealthStatus {
  status: string
  db: string
}

export interface ColumnSchema {
  column: string
  type: string
  nullable: boolean
  geometry_type?: string
  srid?: number
  non_null?: number
  null_count?: number
  distinct?: number
  min?: string | null
  max?: string | null
}

export interface LayerSchema {
  total_count: number
  columns: ColumnSchema[]
}

export interface ImportHistory {
  id: string
  source_file: string
  source_srid: number
  target_srid: number
  feature_count: number
  status: string
  error: string | null
  duration_ms: number | null
  created_at: string
}

export interface ImportResult {
  layer_id: string
  collection_id: string
  table_name: string
  feature_count: number
  geometry_type: string
  bbox: number[] | null
  srid: number
}

const BASE = ''

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, options)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  health: () => request<HealthStatus>('/health'),

  workspaces: {
    list: () => request<Workspace[]>('/api/admin/workspaces'),
    get: (id: string) => request<Workspace>(`/api/admin/workspaces/${id}`),
    create: (data: { name: string; description?: string }) =>
      request<Workspace>('/api/admin/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; description?: string }) =>
      request<Workspace>(`/api/admin/workspaces/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<void>(`/api/admin/workspaces/${id}`, { method: 'DELETE' }),
  },

  layers: {
    list: (workspaceId?: string) => {
      const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''
      return request<Layer[]>(`/api/admin/layers${qs}`)
    },
    get: (id: string) => request<Layer>(`/api/admin/layers/${id}`),
    schema: (id: string) => request<LayerSchema>(`/api/admin/layers/${id}/schema`),
    history: (id: string) => request<ImportHistory[]>(`/api/admin/layers/${id}/history`),
    delete: (id: string) => request<void>(`/api/admin/layers/${id}`, { method: 'DELETE' }),
  },

  import: (data: { workspace_id: string; layer_name: string; file: File; srid?: number }) => {
    const form = new FormData()
    form.append('workspace_id', data.workspace_id)
    form.append('layer_name', data.layer_name)
    if (data.srid) form.append('srid', String(data.srid))
    form.append('file', data.file)
    return request<ImportResult>('/api/admin/import', {
      method: 'POST',
      body: form,
    })
  },
}

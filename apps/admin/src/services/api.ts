export interface Workspace {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface CategoryEntry {
  value: string | number | boolean
  color: string
  label?: string
}

export interface GraduatedClass {
  min: number
  max: number
  color: string
  label?: string
}

export interface StyleConfig {
  type: 'single' | 'categorized' | 'graduated'
  fill_color?: string
  fill_opacity?: number
  stroke_color?: string
  stroke_width?: number
  circle_radius?: number
  field?: string
  categories?: CategoryEntry[]
  method?: 'equal_interval' | 'quantile' | 'manual'
  classes?: GraduatedClass[]
  default_color?: string
}

export interface ClassifyResult {
  type: 'categorized' | 'graduated'
  field: string
  categories?: { value: string | number | boolean }[]
  method?: string
  classes?: { min: number; max: number }[]
  min?: number
  max?: number
}

export interface Collection {
  id: string
  workspace_id: string
  workspace_name: string
  name: string
  description: string | null
  attribution: string | null
  table_name: string
  geometry_column: string
  geometry_type: string | null
  id_column: string
  datetime_column: string | null
  exposed_fields: Array<{ source: string; alias?: string }> | null
  style: StyleConfig | null
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

export interface CollectionSchema {
  total_count: number
  columns: ColumnSchema[]
}

export interface ImportHistory {
  id: string
  source_file: string
  source_srid: number
  target_srid: number
  feature_count: number
  total_features: number | null
  imported_features: number
  progress: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  error: string | null
  duration_ms: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface ImportAccepted {
  import_id: string
  status: string
  message: string
}

export interface JobStatus {
  id: string
  job_id: string | null
  collection_id: string | null
  collection_name: string | null
  source_file: string
  source_srid: number
  target_srid: number
  feature_count: number | null
  total_features: number | null
  imported_features: number
  progress: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  error: string | null
  logs: Array<{ ts: string; level: string; message: string }>
  duration_ms: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
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

async function requestAccepted<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, options)
  if (!res.ok && res.status !== 202) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? `HTTP ${res.status}`)
  }
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

  collections: {
    list: (workspaceId?: string) => {
      const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''
      return request<Collection[]>(`/api/admin/collections${qs}`)
    },
    get: (id: string) => request<Collection>(`/api/admin/collections/${id}`),
    schema: (id: string) => request<CollectionSchema>(`/api/admin/collections/${id}/schema`),
    history: (id: string) => request<ImportHistory[]>(`/api/admin/collections/${id}/history`),
    update: (id: string, data: Record<string, unknown>) =>
      request<Collection>(`/api/admin/collections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    classify: (id: string, params: { field: string; type: string; classes?: number }) => {
      const qs = new URLSearchParams({ field: params.field, type: params.type })
      if (params.classes) qs.set('classes', String(params.classes))
      return request<ClassifyResult>(`/api/admin/collections/${id}/classify?${qs}`)
    },
    delete: (id: string) => request<void>(`/api/admin/collections/${id}`, { method: 'DELETE' }),
    exportUrl: (id: string) => `/api/admin/collections/${id}/export`,
  },

  import: (data: {
    workspace_id: string
    collection_name: string
    file: File
    srid?: number
    separator?: string
    longitude?: string
    latitude?: string
  }) => {
    const form = new FormData()
    form.append('workspace_id', data.workspace_id)
    form.append('collection_name', data.collection_name)
    if (data.srid) form.append('srid', String(data.srid))
    if (data.separator) form.append('separator', data.separator)
    if (data.longitude) form.append('longitude', data.longitude)
    if (data.latitude) form.append('latitude', data.latitude)
    form.append('file', data.file)
    return requestAccepted<ImportAccepted>('/api/admin/import', {
      method: 'POST',
      body: form,
    })
  },

  jobs: {
    list: (params?: {
      status?: string
      collection_id?: string
      limit?: number
      offset?: number
    }) => {
      const qs = new URLSearchParams()
      if (params?.status) qs.set('status', params.status)
      if (params?.collection_id) qs.set('collection_id', params.collection_id)
      if (params?.limit) qs.set('limit', String(params.limit))
      if (params?.offset) qs.set('offset', String(params.offset))
      const query = qs.toString()
      return request<JobStatus[]>(`/api/admin/jobs${query ? `?${query}` : ''}`)
    },
    get: (id: string) => request<JobStatus>(`/api/admin/jobs/${id}`),
  },
}

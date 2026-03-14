# Admin Endpoints

Administration endpoints live under `/api/admin/` to keep the OGC namespace clean.

## Workspaces

### List workspaces

```
GET /api/admin/workspaces
```

Returns all workspaces. A `default` workspace is always present.

### Create a workspace

```
POST /api/admin/workspaces
```

```json
{ "name": "transport", "description": "Transport datasets" }
```

Returns `409 Conflict` if a workspace with the same name already exists.

### Get a workspace

```
GET /api/admin/workspaces/{id}
```

### Update a workspace

```
PUT /api/admin/workspaces/{id}
```

```json
{ "name": "transport", "description": "Updated description" }
```

### Delete a workspace

```
DELETE /api/admin/workspaces/{id}
```

Deleting a workspace cascades to all its layers.

## Layers

### List layers

```
GET /api/admin/layers
```

Supports filtering by workspace:

```
GET /api/admin/layers?workspace_id={uuid}
```

### Get a layer

```
GET /api/admin/layers/{id}
```

Returns full layer metadata including bounding box, feature count, geometry type, and SRID.

### Update a layer

```
PUT /api/admin/layers/{id}
```

All fields are optional — only provided fields are updated.

```json
{
  "workspace_id": "uuid",
  "name": "new_name",
  "description": "Updated description",
  "attribution": "© OpenStreetMap contributors",
  "datetime_column": "date_created",
  "exposed_fields": [{ "source": "name", "alias": "city" }, { "source": "population" }]
}
```

| Field             | Type           | Description                                                          |
| ----------------- | -------------- | -------------------------------------------------------------------- |
| `workspace_id`    | string         | Move the layer to a different workspace                              |
| `name`            | string         | Rename the layer                                                     |
| `description`     | string \| null | Layer description (set to `null` to clear)                           |
| `attribution`     | string \| null | Data attribution text                                                |
| `datetime_column` | string \| null | Column to use for OGC `?datetime=` temporal filtering                |
| `exposed_fields`  | array \| null  | Columns to expose in the API (see [Exposed Fields](#exposed-fields)) |

### Export layer data

```
GET /api/admin/layers/{id}/export
```

Downloads the full layer as a GeoJSON file. The response includes a `Content-Disposition` header for file download. If `exposed_fields` is configured, only those columns are included in the export.

### Delete a layer

```
DELETE /api/admin/layers/{id}
```

Deleting a layer:

- Drops the associated PostGIS data table
- Cascades to import history records

### Layer schema

```
GET /api/admin/layers/{id}/schema
```

Returns column names, types, and basic statistics (distinct values, nulls) for the layer's data table.

### Layer import history

```
GET /api/admin/layers/{id}/history
```

Returns the import history for a specific layer, with progress and timing details.

## Import

### Upload and import a file

```
POST /api/admin/import
```

Multipart form data with the following fields:

| Field          | Type   | Required | Description                                                         |
| -------------- | ------ | -------- | ------------------------------------------------------------------- |
| `file`         | file   | Yes      | GeoJSON (`.geojson`, `.json`, `.geojson.gz`, `.gz`) or CSV (`.csv`) |
| `workspace_id` | string | Yes      | Target workspace UUID                                               |
| `layer_name`   | string | Yes      | Name for the new layer                                              |
| `srid`         | number | No       | Source SRID (default: 4326)                                         |
| `separator`    | string | No       | CSV only — column separator (auto-detected if omitted)              |
| `longitude`    | string | No       | CSV only — longitude column name (auto-detected if omitted)         |
| `latitude`     | string | No       | CSV only — latitude column name (auto-detected if omitted)          |

**Response (202 Accepted):**

```json
{
  "import_id": "abc123-...",
  "status": "pending",
  "message": "Import job queued"
}
```

## Jobs

### List jobs

```
GET /api/admin/jobs
```

| Parameter  | Description                                                   |
| ---------- | ------------------------------------------------------------- |
| `status`   | Filter by status: `pending`, `running`, `completed`, `failed` |
| `layer_id` | Filter by layer UUID                                          |
| `limit`    | Number of results (default: 20)                               |
| `offset`   | Pagination offset                                             |

Returns jobs ordered by `created_at` descending.

### Get job details

```
GET /api/admin/jobs/{id}
```

Returns full job details including progress, logs, and timing:

```json
{
  "id": "abc123-...",
  "source_file": "regions.geojson",
  "layer_name": "regions",
  "status": "running",
  "progress": 45,
  "total_features": 1000,
  "imported_features": 450,
  "logs": [
    {
      "ts": "2026-03-14T10:00:01Z",
      "level": "info",
      "message": "Starting import of regions.geojson"
    },
    { "ts": "2026-03-14T10:00:02Z", "level": "info", "message": "Parsed 1000 features" },
    { "ts": "2026-03-14T10:00:03Z", "level": "info", "message": "Table data_regions ready" },
    { "ts": "2026-03-14T10:00:05Z", "level": "info", "message": "450/1000 features imported" }
  ],
  "error": null,
  "duration_ms": null,
  "created_at": "2026-03-14T10:00:00Z",
  "started_at": "2026-03-14T10:00:01Z",
  "completed_at": null
}
```

### Job statuses

| Status      | Description                                |
| ----------- | ------------------------------------------ |
| `pending`   | Job is queued, waiting for a worker        |
| `running`   | Worker is processing the import            |
| `completed` | Import finished successfully               |
| `failed`    | Import failed (see `error` field and logs) |

Failed jobs are automatically retried up to 3 times by pg-boss, with a 30-second delay between attempts.

## Exposed Fields

By default, all columns from the data table are exposed in the OGC API (features, queryables, vector tiles, and export). You can restrict which columns are visible by configuring `exposed_fields` on a layer.

### Behavior

| `exposed_fields` value    | Effect                           |
| ------------------------- | -------------------------------- |
| `null` (default)          | All columns are exposed          |
| `[]` (empty array)        | Only geometry and ID are exposed |
| `[{source, alias?}, ...]` | Only listed columns are exposed  |

### Aliasing

Each exposed field can have an optional `alias`. When set, the alias replaces the original column name in all API responses:

```json
{
  "exposed_fields": [
    { "source": "nom_commune", "alias": "city" },
    { "source": "pop_totale", "alias": "population" }
  ]
}
```

With this configuration, API consumers see `city` and `population` as property names instead of the raw column names.

### Affected endpoints

Exposed fields filtering applies to:

- **Features** (`/collections/{id}/items`) — only configured columns appear in `properties`
- **Single feature** (`/collections/{id}/items/{fid}`) — same filtering
- **Queryables** (`/collections/{id}/queryables`) — only exposed columns are listed as filterable
- **Vector tiles** (`/collections/{id}/tiles/{z}/{x}/{y}.pbf`) — MVT properties reflect exposed fields
- **Export** (`/api/admin/layers/{id}/export`) — GeoJSON export respects the configuration

## Layer Style

Layers can have a style configuration that defines how features should be rendered. The style is stored as JSONB and supports three classification types.

### Style types

**Single** — one color for all features:

```json
{
  "type": "single",
  "fill_color": "#1B4F72",
  "fill_opacity": 0.3,
  "stroke_color": "#1B4F72",
  "stroke_width": 1.5
}
```

**Categorized** — unique values mapped to colors:

```json
{
  "type": "categorized",
  "field": "category",
  "categories": [
    { "value": "capital", "color": "#e41a1c", "label": "Capital" },
    { "value": "major", "color": "#377eb8", "label": "Major city" }
  ],
  "default_color": "#cccccc",
  "fill_opacity": 0.5
}
```

**Graduated** — numeric ranges mapped to colors:

```json
{
  "type": "graduated",
  "field": "population",
  "method": "quantile",
  "classes": [
    { "min": 0, "max": 100000, "color": "#eff3ff" },
    { "min": 100000, "max": 500000, "color": "#6baed6" },
    { "min": 500000, "max": 2200000, "color": "#08519c" }
  ],
  "default_color": "#cccccc",
  "fill_opacity": 0.5
}
```

Save a style via the [Update a layer](#update-a-layer) endpoint (`PUT /api/admin/layers/{id}` with a `style` field). Set `style` to `null` to remove it.

### Auto-classify

```
GET /api/admin/layers/{id}/classify
```

Generates classification suggestions from the actual data.

| Parameter | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `field`   | string | Yes      | Column name to classify                      |
| `type`    | string | Yes      | `categorized` or `graduated`                 |
| `classes` | number | No       | Number of classes for graduated (default: 5) |

For `categorized`, returns up to 50 distinct values. For `graduated`, computes quantile breakpoints.

### OGC style endpoint

```
GET /collections/{collectionId}/style
```

Returns the style configuration for a collection. Returns `204 No Content` if no style is configured.

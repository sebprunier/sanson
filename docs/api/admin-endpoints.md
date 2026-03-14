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

| Field          | Type   | Required | Description                                              |
| -------------- | ------ | -------- | -------------------------------------------------------- |
| `file`         | file   | Yes      | GeoJSON file (`.geojson`, `.json`, `.geojson.gz`, `.gz`) |
| `workspace_id` | string | Yes      | Target workspace UUID                                    |
| `layer_name`   | string | Yes      | Name for the new layer                                   |
| `srid`         | number | No       | Source SRID (default: 4326)                              |

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

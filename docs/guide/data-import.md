# Data Import

Sanson supports importing GeoJSON files to create geographic layers. Imports are processed asynchronously with real-time progress tracking.

## Supported formats

| Format         | Extensions           |
| -------------- | -------------------- |
| GeoJSON        | `.geojson`, `.json`  |
| GeoJSON (gzip) | `.geojson.gz`, `.gz` |

Gzip-compressed files are automatically detected (by extension or magic bytes) and decompressed before processing.

::: info Planned
Shapefile support (`.shp` + `.dbf` + `.prj` in a `.zip`) via `ogr2ogr` is planned for a future release.
:::

## Import via the Admin UI

1. Navigate to the **Import** page in the admin UI
2. Select a **GeoJSON file** from your computer
3. Choose the target **workspace** (defaults to `default`)
4. Set the **layer name** (auto-generated from the filename)
5. Set the **SRID** (defaults to 4326 / WGS84)
6. Click **Import**

The UI transitions to a progress view showing:

- Status badge (queued, importing, complete, or failed)
- Progress bar (0-100%)
- Feature count (imported / total)
- Live structured logs

On completion, a **View layer** button links directly to the layer detail page with map and table views.

## Import via the API

```bash
curl -X POST http://localhost:3000/api/admin/import \
  -F "file=@data/regions-1000m.geojson" \
  -F "workspace_id=<workspace-uuid>" \
  -F "layer_name=regions" \
  -F "srid=4326"
```

The API returns `202 Accepted`:

```json
{
  "import_id": "abc123-...",
  "status": "pending",
  "message": "Import job queued"
}
```

Monitor progress by polling the job status:

```bash
curl http://localhost:3000/api/admin/jobs/<import_id>
```

See [Admin Endpoints](/api/admin-endpoints) for full API details.

## How it works

The import pipeline is fully asynchronous:

1. **Upload** — the API receives the file and saves it to disk (`UPLOAD_DIR`)
2. **Queue** — a pg-boss job is created with the import parameters
3. **Parse** — the worker picks up the job, reads and parses the GeoJSON (decompressing if needed)
4. **Create table** — a PostGIS table is created with columns inferred from the first feature's properties
5. **Insert** — features are inserted in batches of 500, with progress updated after each batch
6. **Index** — a GIST spatial index is created on the geometry column
7. **Metadata** — layer metadata is updated (bounding box, feature count, geometry type)
8. **Cleanup** — the uploaded file is deleted

## Geometry type handling

GeoJSON files can contain mixed geometry types (e.g., both `Polygon` and `MultiPolygon`). Sanson handles this by automatically promoting all geometries to their Multi variant:

- `Point` becomes `MultiPoint`
- `LineString` becomes `MultiLineString`
- `Polygon` becomes `MultiPolygon`

Every geometry is wrapped with `ST_Multi()` on insert, ensuring consistency within the PostGIS table.

## File size

The maximum upload size is **100 MB**. For larger datasets, consider splitting the file or using gzip compression.

## Troubleshooting

| Error                   | Cause                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| Invalid GeoJSON         | The file is not valid GeoJSON or is missing the `features` array   |
| Empty FeatureCollection | The GeoJSON file contains no features                              |
| Workspace not found     | The specified `workspace_id` does not exist                        |
| Geometry type mismatch  | Should not happen with automatic Multi promotion — report as a bug |

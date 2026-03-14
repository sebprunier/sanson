# Data Import

Sanson supports importing GeoJSON and CSV files to create geographic layers. Imports are processed asynchronously with real-time progress tracking.

## Supported formats

| Format         | Extensions           |
| -------------- | -------------------- |
| GeoJSON        | `.geojson`, `.json`  |
| GeoJSON (gzip) | `.geojson.gz`, `.gz` |
| CSV            | `.csv`               |

Gzip-compressed GeoJSON files are automatically detected (by extension or magic bytes) and decompressed before processing.

::: info Planned
Shapefile support (`.shp` + `.dbf` + `.prj` in a `.zip`) via `ogr2ogr` is planned for a future release.
:::

## Import via the Admin UI

1. Navigate to the **Import** page in the admin UI
2. Select a **GeoJSON or CSV file** from your computer
3. Choose the target **workspace** (defaults to `default`)
4. Set the **layer name** (auto-generated from the filename)
5. Set the **SRID** (defaults to 4326 / WGS84)
6. For CSV files, optionally configure the **separator**, **longitude column**, and **latitude column** (all are auto-detected by default)
7. Click **Import**

The UI transitions to a progress view showing:

- Status badge (queued, importing, complete, or failed)
- Progress bar (0-100%)
- Feature count (imported / total)
- Live structured logs

On completion, a **View layer** button links directly to the layer detail page with map and table views.

## Import via the API

**GeoJSON:**

```bash
curl -X POST http://localhost:3000/api/admin/import \
  -F "file=@data/regions-1000m.geojson" \
  -F "workspace_id=<workspace-uuid>" \
  -F "layer_name=regions" \
  -F "srid=4326"
```

**CSV:**

```bash
curl -X POST http://localhost:3000/api/admin/import \
  -F "file=@data/gares.csv" \
  -F "workspace_id=<workspace-uuid>" \
  -F "layer_name=gares" \
  -F "srid=4326" \
  -F "separator=;" \
  -F "longitude=X_WGS84" \
  -F "latitude=Y_WGS84"
```

The `separator`, `longitude`, and `latitude` fields are optional — they are auto-detected when not provided.

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
3. **Parse** — the worker picks up the job, reads and parses the file (GeoJSON or CSV)
4. **Create table** — a PostGIS table is created with columns inferred from the data
5. **Insert** — features/rows are inserted in batches of 500, with progress updated after each batch
6. **Index** — a GIST spatial index is created on the geometry column
7. **Metadata** — layer metadata is updated (bounding box, feature count, geometry type)
8. **Cleanup** — the uploaded file is deleted

## GeoJSON specifics

### Geometry type handling

GeoJSON files can contain mixed geometry types (e.g., both `Polygon` and `MultiPolygon`). Sanson handles this by automatically promoting all geometries to their Multi variant:

- `Point` becomes `MultiPoint`
- `LineString` becomes `MultiLineString`
- `Polygon` becomes `MultiPolygon`

Every geometry is wrapped with `ST_Multi()` on insert, ensuring consistency within the PostGIS table.

## CSV specifics

CSV import creates `MultiPoint` geometry from longitude/latitude columns.

### Separator auto-detection

When no separator is specified, Sanson counts occurrences of `;`, `,`, and tab characters in the header line and picks the most frequent. You can override this with the `separator` parameter.

### Geo column auto-detection

If longitude/latitude column names are not provided, Sanson matches header names against common conventions:

| Longitude                         | Latitude          |
| --------------------------------- | ----------------- |
| `longitude`, `lon`, `lng`, `long` | `latitude`, `lat` |
| `x_wgs84`                         | `y_wgs84`         |
| `x`, `centroid_x`                 | `y`, `centroid_y` |

Names are matched by priority: explicit names (`longitude`, `lat`...) first, then WGS84-specific (`x_wgs84`), then generic (`x`, `y`) last. Matching is case-insensitive. If no match is found, the import fails with an error asking you to specify columns explicitly.

::: warning Projected coordinates
Column names like `x_l93`/`y_l93` (Lambert 93) are **not** auto-detected because they contain projected coordinates in meters, not WGS84 degrees. To import such data, specify the columns and SRID explicitly.
:::

### Column types

Column types are inferred from the first 100 rows:

- If all non-empty values are numeric integers → `INTEGER`
- If all non-empty values are numeric with decimals → `DOUBLE PRECISION`
- Otherwise → `TEXT`

### Skipped rows

Rows with missing or non-numeric longitude/latitude values are silently skipped. The final import summary includes the number of skipped rows.

## File size

The maximum upload size is **100 MB**. For larger datasets, consider splitting the file or using gzip compression.

## Troubleshooting

| Error                                            | Cause                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| Invalid GeoJSON                                  | The file is not valid GeoJSON or is missing the `features` array          |
| Empty FeatureCollection                          | The GeoJSON file contains no features                                     |
| Workspace not found                              | The specified `workspace_id` does not exist                               |
| Geometry type mismatch                           | Should not happen with automatic Multi promotion — report as a bug        |
| Could not auto-detect longitude/latitude columns | CSV file headers don't match known column names — specify them explicitly |
| CSV must have a header row                       | CSV file is empty or has only a header with no data rows                  |

# Data Import

Sanson supports importing GeoJSON, CSV, and Shapefile data to create geographic layers. Imports are processed asynchronously with real-time progress tracking.

## Supported formats

| Format         | Extensions           | Notes                                            |
| -------------- | -------------------- | ------------------------------------------------ |
| GeoJSON        | `.geojson`, `.json`  | Must be a FeatureCollection                      |
| GeoJSON (gzip) | `.geojson.gz`, `.gz` | Auto-detected by extension or magic bytes        |
| CSV            | `.csv`               | Requires longitude/latitude columns              |
| Shapefile      | `.zip`               | ZIP containing `.shp` + `.dbf` + `.prj` + `.shx` |

## Import via the Admin UI

1. Navigate to the **Import** page in the admin UI
2. Select a **GeoJSON, CSV, or Shapefile (.zip)** from your computer
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

**Shapefile:**

```bash
curl -X POST http://localhost:3000/api/admin/import \
  -F "file=@data/AleaRG_2025_86_L93.zip" \
  -F "workspace_id=<workspace-uuid>" \
  -F "layer_name=alea_argiles" \
  -F "srid=4326"
```

For Shapefiles, `srid` is the **target** storage SRID. The source SRID is auto-detected from the `.prj` file and the data is reprojected automatically.

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

1. **Upload** — the API receives the file and saves it to disk (`UPLOAD_DIR`). Shapefiles are streamed directly to disk to handle large files efficiently.
2. **Queue** — a pg-boss job is created with the import parameters
3. **Process** — the worker picks up the job and processes the file (format-specific, see below)
4. **Index** — a GIST spatial index is created on the geometry column
5. **Metadata** — layer metadata is updated (bounding box, feature count, geometry type)
6. **Cleanup** — the uploaded file is deleted

## GeoJSON specifics

### Geometry type handling

GeoJSON files can contain mixed geometry types (e.g., both `Polygon` and `MultiPolygon`). Sanson handles this by automatically promoting all geometries to their Multi variant:

- `Point` becomes `MultiPoint`
- `LineString` becomes `MultiLineString`
- `Polygon` becomes `MultiPolygon`

Every geometry is wrapped with `ST_Multi()` on insert, ensuring consistency within the PostGIS table.

### Processing

The worker parses the GeoJSON, creates a PostGIS table with columns inferred from feature properties, and inserts features in batches of 500 with progress updates after each batch.

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

## Shapefile specifics

Shapefile import uses **ogr2ogr** (GDAL CLI) for direct-to-PostGIS import. This requires `ogr2ogr` to be installed on the system (`gdal-bin` on Debian/Ubuntu, `gdal` on macOS via Homebrew).

### How it works

1. **Inspect** — `ogrinfo -json -so` reads metadata from the ZIP (feature count, geometry type, source SRID from `.prj`)
2. **Import** — `ogr2ogr -f PostgreSQL` bulk-inserts the data via `COPY`, with automatic reprojection to the target SRID
3. **Multi layers** — if the ZIP contains multiple Shapefile layers, only the first is imported (with a warning in the logs)

### SRID handling

The source SRID is auto-detected from the `.prj` file. If no SRID can be detected, the target SRID is used as the source SRID (with a warning). All data is reprojected to the target SRID on import.

### Geometry promotion

Like GeoJSON, geometries are promoted to their Multi variant (`-nlt PROMOTE_TO_MULTI`) for consistency.

### Re-import

When importing into an existing layer (same workspace + name), the data table is dropped and recreated. This ensures no stale data from previous imports.

## File size

The maximum upload size is **1 GB**. Shapefile uploads are streamed directly to disk without buffering in memory, so large files (hundreds of MB) are handled efficiently. For GeoJSON and CSV, consider using gzip compression for large files.

## Troubleshooting

| Error                                            | Cause                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| Invalid GeoJSON                                  | The file is not valid GeoJSON or is missing the `features` array          |
| Empty FeatureCollection                          | The GeoJSON file contains no features                                     |
| Workspace not found                              | The specified `workspace_id` does not exist                               |
| Geometry type mismatch                           | Should not happen with automatic Multi promotion — report as a bug        |
| Could not auto-detect longitude/latitude columns | CSV file headers don't match known column names — specify them explicitly |
| CSV must have a header row                       | CSV file is empty or has only a header with no data rows                  |
| No layers found in ZIP file                      | The ZIP doesn't contain a valid Shapefile (.shp)                          |
| Failed to spawn ogr2ogr                          | GDAL/ogr2ogr is not installed or not on PATH                              |

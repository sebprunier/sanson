# Sanson — Specifications

> Version 0.4 — March 2026

---

## 1. Why "Sanson"?

**Nicolas Sanson** (1600–1667) is considered the **father of French cartography**. Royal geographer to Louis XIII and then Louis XIV, he founded the first French school of cartography and produced hundreds of maps of remarkable precision for his time. His work laid the methodological foundations of modern cartography, which the Cassini family later continued in the following century.

Just as Nicolas Sanson organized and presented the geographical knowledge of his era, **Sanson** (the software) organizes and exposes geographic data through modern APIs.

---

## 2. Vision

Sanson is an open source geospatial server whose goal is to expose geographic data stored in PostgreSQL/PostGIS via **OGC API — Features compliant REST APIs** and a **web administration interface**.

Founding principle: do one thing, do it well. Sanson is a geographic data publishing tool — not an API management tool, not a data processing tool, not an environment management tool.

**Conformance goal:** Sanson implements a subset of **OGC API — Features** (Parts 1, 2, and 3), targeting full conformance with the Core, GeoJSON, and CQL2 Text conformance classes. This ensures native compatibility with standard GIS clients (QGIS, ArcGIS, FME…) without any special configuration.

---

## 3. Out of scope

| Out of scope                                           | Reason                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| API Management (authentication, quotas, rate limiting) | Responsibility of another component (e.g., Otoroshi, Kong)               |
| Environment management (staging, prod…)                | Separation of concerns                                                   |
| Legacy OGC protocols (WMS, WFS, WCS, WPS)              | Disproportionate complexity vs. value — OGC API Features covers the need |
| Complex spatial processing/analysis                    | PostGIS / dedicated tools                                                |
| Raster tile generation                                 | Out of scope                                                             |

---

## 4. Business concepts

### Workspace

Logical namespace that groups layers. Used to organize data by theme or project.
Example: `transport`, `risques`, `administratif`.

### Layer

Central unit of Sanson. A layer represents a geographic dataset exposed via the API. In OGC API Features vocabulary, a layer corresponds to a **Collection**. It is associated with:

- a source PostGIS table (with GIST spatial index)
- a workspace
- metadata (name, description, attribution)
- exposure configuration (exposed fields, default filter)
- an optional Mapbox GL style (for visualization)
- the storage SRID
- an optional bounding box and temporal extent (OGC conformance)

### Import

Ingestion operation for a geographic data file (GeoJSON, Shapefile) to create or populate a layer. An import is processed asynchronously by a Worker node. Its state is tracked via a Job.

### Job

Asynchronous unit of work managed by the queue. A job has a type (`ingest`), a state (`pending`, `running`, `completed`, `failed`), parameters, execution logs, and timestamps.

### Style

A Mapbox GL JSON style associated with a layer, used in the administration interface for map visualization.

---

## 5. Technical architecture

### 5.1 Stack

| Component              | Technology                               |
| ---------------------- | ---------------------------------------- |
| Backend (API + Worker) | Node.js 24 LTS + TypeScript + Fastify    |
| Database               | PostgreSQL 16 + PostGIS 3.4              |
| Job queue              | PostgreSQL + `pg-boss`                   |
| Geospatial ingestion   | `ogr2ogr` (GDAL CLI) + PostgreSQL `COPY` |
| Admin frontend         | React + MapLibre GL JS + Vite            |
| Code organization      | Monorepo (`pnpm workspaces`)             |
| Containerization       | Docker + Docker Compose                  |

### 5.2 Single binary — node modes

Sanson is distributed as a **single binary**. Startup behavior is determined by the `NODE_MODE` environment variable.

| Value    | Behavior                                                                 |
| -------- | ------------------------------------------------------------------------ |
| `api`    | Starts the HTTP server only (Fastify)                                    |
| `worker` | Starts the ingestion engine only (pg-boss worker)                        |
| `all`    | Starts both (default — convenient for development and small deployments) |

This pattern allows scaling API nodes and Worker nodes independently based on load.

```
                    ┌──────────────────────────────────────┐
                    │         Clients / Admin UI            │
                    └────────────┬─────────────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │         API Nodes (NODE_MODE=api)    │
              │         Node.js / Fastify            │
              │                                      │
              │  OGC:   /, /conformance, /api,       │
              │         /collections/...             │
              │  Admin: /api/admin/...               │
              └──────────────────┬──────────────────┘
                                 │
              ┌──────────────────▼──────────────────────────────┐
              │              PostgreSQL + PostGIS                │
              │                                                  │
              │  • geo data (per-layer tables + GIST indexes)    │
              │  • metadata (workspaces, layers, styles)         │
              │  • job queue (pg-boss)                           │
              └──────────────────┬──────────────────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │     Worker Nodes (NODE_MODE=worker)  │
              │                                      │
              │  1. dequeue a job from the queue      │
              │  2. run ogr2ogr → CSV + EWKT          │
              │  3. bulk COPY → PostgreSQL             │
              │  4. create GIST spatial index          │
              │  5. update layer metadata              │
              └──────────────────────────────────────┘
```

### 5.3 Route separation

Sanson exposes two distinct URL spaces:

| Prefix        | Role                       | Examples                                           |
| ------------- | -------------------------- | -------------------------------------------------- |
| `/` (root)    | OGC API Features endpoints | `/`, `/conformance`, `/api`, `/collections/...`    |
| `/api/admin/` | Administration API         | `/api/admin/jobs/...`, `/api/admin/workspaces/...` |

This separation ensures that OGC endpoints live exactly where the spec expects them (at the root), and that administration functions do not pollute the OGC namespace.

### 5.4 Ingestion pipeline

```
Uploaded file (.shp, .geojson)
        │
        ▼
ogr2ogr (source SRID detection, reprojection to target SRID)
  → CSV export with geometry as EWKT (SRID=XXXX; prefix)
  → options: -lco GEOMETRY=AS_WKT -lco SEPARATOR=SEMICOLON
        │
        ▼
(optional) field transformation — filtering, renaming
        │
        ▼
Bulk COPY to PostgreSQL
  → DELIMITER ';' CSV HEADER
  → FREEZE option for initial loads (bypasses WAL, faster)
        │
        ▼
Create GIST spatial index on the geometry column
        │
        ▼
Update layer metadata (bbox, feature_count, temporal_extent)
```

**Implementation notes (from auxalentours-api):**

- ogr2ogr handles format conversion AND reprojection in a single pass
- Geometries are exported as WKT prefixed with `SRID=4326;` (EWKT) so PostgreSQL recognizes the SRID during COPY
- For very large geometries (administrative boundaries), upstream simplification can be considered (e.g., `mapshaper -simplify`) — out of scope for V1

### 5.5 Job queue

The job queue relies on **PostgreSQL via `pg-boss`** — zero additional infrastructure.

The mechanism is based on `SELECT ... FOR UPDATE SKIP LOCKED`: multiple workers can run in parallel without risk of processing the same job twice. PostgreSQL handles concurrency atomically.

pg-boss features used:

- Automatic retry on failure (configurable: number of attempts, delay)
- Expiration of stuck jobs
- Job history

### 5.6 Uploaded file storage

Initial phase: direct upload on the node receiving the request, local storage, file path passed to the worker via the job record.

Planned evolution: object storage (S3-compatible) to decouple upload and processing — without changing business logic.

### 5.7 Spatial indexing

Every geographic data table **must** have a GIST spatial index on the geometry column. Without this index, `ST_Intersects` and `bbox` queries will have catastrophic performance.

```sql
CREATE INDEX idx_{table_name}_geom ON {table_name} USING GIST ({geometry_column});
```

This index is automatically created by the worker at the end of the ingestion pipeline.

### 5.8 Pagination SQL pattern

For pagination, Sanson uses a single query that returns both paginated results AND the total count, via a CTE + RIGHT JOIN:

```sql
WITH all_data AS (
    {base_query}
)
SELECT *, full_count
FROM (
    TABLE all_data
    LIMIT :limit
    OFFSET :offset
) sub
RIGHT JOIN (SELECT COUNT(*) FROM all_data) c(full_count) ON TRUE;
```

This pattern (from auxalentours-api) avoids a second round trip to the database for the count. If no results match, a row with `full_count = 0` and NULL values is returned.

---

## 6. SRID handling

| Phase            | Behavior                                                                                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Import**       | Automatic source SRID detection via `ogr2ogr` / GDAL. If not detectable, mandatory field in the UI.                                                                                                                                                                                                               |
| **Storage**      | Configurable SRID per layer. Default: **WGS84 (EPSG:4326)**. Storing in the native data SRID avoids reprojection on every import.                                                                                                                                                                                 |
| **API exposure** | Always **WGS84 (4326)** by default — required by OGC API Features (GeoJSON) conformance. Optional `?crs=XXXX` parameter (OGC name: `crs`) to expose in another projection — on-the-fly `ST_Transform` on the PostGIS side. Note: if the requested CRS differs from the storage SRID, the query is more expensive. |
| **Vector tiles** | Always **Web Mercator (EPSG:3857)** — MVT standard. `ST_Transform` applied in `ST_AsMVTGeom`.                                                                                                                                                                                                                     |

---

## 7. OGC API — Features conformance

### Targeted conformance classes

| Conformance class            | OGC URI                                                                  | Status |
| ---------------------------- | ------------------------------------------------------------------------ | ------ |
| **Core**                     | `http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core`            | V1     |
| **GeoJSON**                  | `http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson`         | V1     |
| **OAS30**                    | `http://www.opengis.net/spec/ogcapi-common/1.0/req/oas30`                | V1     |
| **Filter**                   | `http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter`          | V1     |
| **Features Filter**          | `http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/features-filter` | V1     |
| **Queryables**               | `http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/queryables`      | V1     |
| **CQL2 Text**                | `http://www.opengis.net/spec/cql2/1.0/req/cql2-text`                     | V1     |
| **CQL2 Basic**               | `http://www.opengis.net/spec/cql2/1.0/req/basic-cql2`                    | V1     |
| **CQL2 Basic Spatial**       | `http://www.opengis.net/spec/cql2/1.0/req/basic-spatial-operators`       | V1     |
| **CQL2 Advanced Comparison** | `http://www.opengis.net/spec/cql2/1.0/req/advanced-comparison-operators` | V1     |
| **CQL2 JSON**                | `http://www.opengis.net/spec/cql2/1.0/req/cql2-json`                     | V2     |
| **CQL2 Temporal**            | `http://www.opengis.net/spec/cql2/1.0/req/temporal-operators`            | V2     |
| **CQL2 Spatial** (full)      | `http://www.opengis.net/spec/cql2/1.0/req/spatial-operators`             | V2     |
| **CRS by Reference**         | `http://www.opengis.net/spec/ogcapi-features-2/1.0/conf/crs`             | V2     |

### OGC URL mapping

```
GET /                                                        Landing page
GET /conformance                                             Conformance declaration
GET /api                                                     OpenAPI 3.0 specification
GET /collections                                             List of collections (all workspaces)
GET /collections/{collectionId}                              Collection metadata
GET /collections/{collectionId}/items                        Features (with filters, pagination)
GET /collections/{collectionId}/items/{fid}                  Feature by identifier
GET /collections/{collectionId}/queryables                   Filterable properties (JSON Schema)
```

**Collection naming convention:** `{workspaceId}:{layerName}` (e.g., `risques:icpe`).

> Note: the `:` separator is a reserved character in RFC 3986 but is widely used in practice (GeoServer uses the same convention). If conflicts arise with a strict proxy or WAF, clients can encode it as `risques%3Aicpe`.

### Response formats — OGC conformance

#### Landing page (`GET /`)

```json
{
  "title": "Sanson",
  "description": "An open source geospatial server — OGC API Features compliant",
  "links": [
    { "href": "/", "rel": "self", "type": "application/json" },
    { "href": "/conformance", "rel": "conformance", "type": "application/json" },
    { "href": "/collections", "rel": "data", "type": "application/json" },
    {
      "href": "/api",
      "rel": "service-desc",
      "type": "application/vnd.oai.openapi+json;version=3.0"
    }
  ]
}
```

#### Conformance declaration (`GET /conformance`)

```json
{
  "conformsTo": [
    "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core",
    "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson",
    "http://www.opengis.net/spec/ogcapi-common/1.0/req/oas30",
    "http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter",
    "http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/features-filter",
    "http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/queryables",
    "http://www.opengis.net/spec/cql2/1.0/req/cql2-text",
    "http://www.opengis.net/spec/cql2/1.0/req/basic-cql2",
    "http://www.opengis.net/spec/cql2/1.0/req/basic-spatial-operators",
    "http://www.opengis.net/spec/cql2/1.0/req/advanced-comparison-operators"
  ]
}
```

#### Collection (`GET /collections/{id}`)

```json
{
  "id": "risques:icpe",
  "title": "ICPE",
  "description": "Installations classified for environmental protection",
  "extent": {
    "spatial": { "bbox": [[-5.1, 41.3, 9.6, 51.1]] },
    "temporal": { "interval": [["2020-01-01T00:00:00Z", null]] }
  },
  "itemType": "feature",
  "crs": ["http://www.opengis.net/def/crs/OGC/1.3/CRS84"],
  "links": [
    { "href": "/collections/risques:icpe", "rel": "self", "type": "application/json" },
    { "href": "/collections/risques:icpe/items", "rel": "items", "type": "application/geo+json" },
    {
      "href": "/collections/risques:icpe/queryables",
      "rel": "queryables",
      "type": "application/schema+json"
    }
  ]
}
```

#### Queryables (`GET /collections/{id}/queryables`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "/collections/risques:icpe/queryables",
  "type": "object",
  "title": "ICPE",
  "properties": {
    "geom": {
      "$ref": "https://geojson.org/schema/Geometry.json"
    },
    "nom": {
      "title": "Facility name",
      "type": "string"
    },
    "regime": {
      "title": "Regime",
      "type": "string",
      "enum": ["Autorisation", "Enregistrement", "Seveso"]
    },
    "etat": {
      "title": "Status",
      "type": "string"
    }
  }
}
```

This endpoint allows GIS clients (QGIS in particular) to dynamically build CQL2 filters without knowing the schema in advance.

#### FeatureCollection (`GET /collections/{id}/items`)

```json
{
  "type": "FeatureCollection",
  "features": [...],
  "numberMatched": 142,
  "numberReturned": 25,
  "timeStamp": "2026-03-13T10:00:00Z",
  "links": [
    { "href": "/collections/risques:icpe/items?offset=0&limit=25",  "rel": "self" },
    { "href": "/collections/risques:icpe/items?offset=25&limit=25", "rel": "next" }
  ]
}
```

**Additional HTTP headers:**

```
X-Total-Count: 142
Link: </collections/risques:icpe/items?offset=0&limit=25>; rel="self",
      </collections/risques:icpe/items?offset=25&limit=25>; rel="next",
      </collections/risques:icpe/items?offset=0&limit=25>; rel="first",
      </collections/risques:icpe/items?offset=125&limit=25>; rel="last"
```

Pagination links are present both in the JSON body (`links`) and in HTTP headers (`Link`, `X-Total-Count`).

---

## 8. Features

### 8.1 Data ingestion

**Supported formats:**

- GeoJSON (`.geojson`, `.json`)
- Shapefile (`.shp` + `.dbf` + `.prj` in a `.zip`)

**Behaviors:**

- Automatic source SRID detection
- Reprojection to target storage SRID (configurable, default 4326)
- Automatic PostGIS table creation if it doesn't exist
- Automatic GIST spatial index creation
- Append mode if the table already exists
- Real-time progress tracking in the UI
- Import history per layer (date, source file, feature count, status, error logs)
- Automatic layer metadata recalculation after import (bbox, feature_count, temporal_extent)

### 8.2 Data API — Query parameters

#### Geographic filters (OGC Core)

| Parameter | Description                                | Example                   |
| --------- | ------------------------------------------ | ------------------------- |
| `bbox`    | Bounding box `minLon,minLat,maxLon,maxLat` | `?bbox=2.2,48.8,2.5,49.0` |

#### Sanson geographic shortcuts

Non-standard convenience parameters, translated server-side into PostGIS queries. The geometry column used is the one configured in `sanson_layers.geometry_column`.

| Parameter                | Description                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `lat` + `lon`            | Translated to `ST_Intersects({geom_col}, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))`                                          |
| `lat` + `lon` + `radius` | Translated to `ST_Intersects({geom_col}, ST_Buffer(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius)::geometry)` |

> Note: the `::geography` cast for the buffer ensures the radius is in meters, regardless of the storage SRID.

#### Temporal filter (OGC Core)

| Parameter  | Description                  | Example                                                     |
| ---------- | ---------------------------- | ----------------------------------------------------------- |
| `datetime` | ISO 8601 instant or interval | `?datetime=2024-01-01` or `?datetime=2023-01-01/2024-01-01` |

Requires the layer to have a configured `datetime_column`.

#### Attribute filters — CQL2 Text (OGC CQL2)

| Parameter     | Description                                          |
| ------------- | ---------------------------------------------------- |
| `filter`      | CQL2 Text expression                                 |
| `filter-lang` | `cql2-text` (default and only supported value in V1) |

**CQL2 Text subset supported in V1:**

- Comparison: `=`, `<>`, `<`, `<=`, `>`, `>=`
- Logic: `AND`, `OR`, `NOT`
- Text: `LIKE`, `ILIKE`
- Nullity: `IS NULL`, `IS NOT NULL`
- List: `IN ('val1', 'val2')`
- Spatial operators: `S_INTERSECTS`, `S_WITHIN`, `S_CONTAINS`

Combined geo + attribute query:

```
GET /collections/risques:icpe/items
  ?bbox=2.2,48.8,2.5,49.0
  &filter=regime='Seveso' AND etat='En activité'
  &filter-lang=cql2-text
```

#### Pagination (OGC Core)

| Parameter | Default | Max   |
| --------- | ------- | ----- |
| `limit`   | `25`    | `100` |
| `offset`  | `0`     | —     |

The `next` / `prev` / `first` / `last` links in the response (body + headers) allow navigation without manually managing `offset`.

#### Other parameters

| Parameter | Description                              |
| --------- | ---------------------------------------- |
| `f`       | Output format: `json` (default, GeoJSON) |

### 8.3 Feature by identifier

```
GET /collections/{collectionId}/items/{fid}
```

### 8.4 Vector tiles (MVT)

```
GET /collections/{collectionId}/tiles/{z}/{x}/{y}.pbf
```

**Mapbox Vector Tiles** format (`.pbf`). Compatible with MapLibre GL JS, Leaflet + plugins, QGIS, etc.

**PostGIS implementation:**

```sql
WITH mvtgeom AS (
    SELECT ST_AsMVTGeom(
        ST_Transform({geometry_column}, 3857),
        ST_TileEnvelope(:z, :x, :y),
        extent => 4096,
        buffer => 256
    ) AS geom,
    {exposed_fields}
    FROM {table_name}
    WHERE {geometry_column} && ST_Transform(ST_TileEnvelope(:z, :x, :y, margin => (256.0 / 4096)), {srid})
)
SELECT ST_AsMVT(mvtgeom.*, :layerName) FROM mvtgeom;
```

- `extent=4096`: tile resolution (standard)
- `buffer=256`: margin around the tile to avoid edge artifacts
- `margin => (256.0 / 4096)` in `ST_TileEnvelope`: expands the search bbox to include features in the buffer
- The spatial filter uses `&&` (bbox operator on the GIST index) for performance

### 8.5 Queryables

```
GET /collections/{collectionId}/queryables
```

Returns a JSON Schema describing the filterable properties of the collection. Dynamically generated from `sanson_layers.exposed_fields` and the source PostGIS table schema. Allows GIS clients (QGIS) to build CQL2 filters without prior knowledge of the schema.

### 8.6 Jobs (Administration API)

```
POST /api/admin/jobs/ingest         Create an ingestion job (multipart: file + config)
GET  /api/admin/jobs/{jobId}        Job state and logs
GET  /api/admin/jobs                Job history (filterable by status, layer, workspace)
```

### 8.7 Workspaces and Layers (Administration API)

```
GET    /api/admin/workspaces                    List workspaces
POST   /api/admin/workspaces                    Create a workspace
GET    /api/admin/workspaces/{id}               Workspace details
PUT    /api/admin/workspaces/{id}               Update a workspace
DELETE /api/admin/workspaces/{id}               Delete a workspace

GET    /api/admin/layers                        List layers (filterable by workspace)
POST   /api/admin/layers                        Create a layer
GET    /api/admin/layers/{id}                   Layer details
PUT    /api/admin/layers/{id}                   Update a layer
DELETE /api/admin/layers/{id}                   Delete a layer
```

---

## 9. Web administration interface

Single-page React application, served by API nodes.

### Dashboard

- Number of workspaces, layers, total features
- PostgreSQL/PostGIS connection status
- Recent jobs (last 24h) with their status

### Workspace and Layer management

- List of workspaces → list of layers per workspace
- Create / edit / delete workspace
- Create / edit / delete layer
  - Name, description, attribution
  - Storage SRID
  - Exposed fields (selection, renaming)
  - Datetime field (for OGC temporal filter)
  - Mapbox GL style (JSON editor)

### Layer exploration

- **Map view**: data visualization with MapLibre GL, configurable style
- **Table view**: tabular exploration with sorting and search
- **Schema view**: field list, types, basic statistics (min, max, nulls)

### Data import

- File upload (GeoJSON or Shapefile ZIP)
- Workspace and target layer selection (existing or new)
- Target SRID choice (default: 4326)
- Real-time progress tracking
- Execution logs

### API explorer

- Scalar interface on the OpenAPI 3.0 specification auto-generated by Fastify
- Allows testing all OGC endpoints directly from the browser

---

## 10. Data model — metadata tables

```sql
-- Workspaces
CREATE TABLE sanson_workspaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Layers (= OGC Collections)
CREATE TABLE sanson_layers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID REFERENCES sanson_workspaces(id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    description       TEXT,
    attribution       TEXT,
    table_name        VARCHAR(200) NOT NULL,       -- associated PostGIS table
    geometry_column   VARCHAR(100) DEFAULT 'geom',
    geometry_type     VARCHAR(50),                  -- Point, MultiPolygon, etc.
    id_column         VARCHAR(100) DEFAULT 'id',
    datetime_column   VARCHAR(100),                -- column for OGC ?datetime filter
    srid              INTEGER DEFAULT 4326,
    bbox              JSONB,                        -- [minLon, minLat, maxLon, maxLat]
    temporal_extent   JSONB,                        -- ["2020-01-01T00:00:00Z", null]
    exposed_fields    JSONB,                        -- [{source: 'nom', alias: 'name', type: 'string'}, ...]
    style             JSONB,                        -- Mapbox GL Style JSON
    feature_count     BIGINT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE(workspace_id, name)
);

-- Import history
CREATE TABLE sanson_import_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer_id      UUID REFERENCES sanson_layers(id),
    job_id        UUID,                              -- pg-boss reference
    source_file   VARCHAR(500),
    source_srid   INTEGER,
    target_srid   INTEGER,
    feature_count BIGINT,
    status        VARCHAR(20),                       -- completed, failed
    error         TEXT,
    duration_ms   INTEGER,
    created_at    TIMESTAMPTZ DEFAULT now()
);
```

**Notes:**

- `geometry_type` is detected at import and used for the `/queryables` endpoint
- `exposed_fields` includes each field's type (string, number, integer, boolean) for generating the queryables schema
- Every geographic data table referenced by `table_name` must have a GIST index: `CREATE INDEX ... USING GIST ({geometry_column})`

---

## 11. Code organization (monorepo)

```
sanson/
├── packages/
│   ├── core/           Shared types, DB utils, models, CQL2 Text parser
│   ├── api/            Fastify server, OGC + admin routes, handlers
│   └── worker/         pg-boss workers, ogr2ogr pipeline
├── apps/
│   └── admin/          React + MapLibre GL frontend
├── docker/
│   ├── Dockerfile
│   └── compose.yml
├── scripts/
│   └── init.sql        Metadata table creation
└── SPECS.md
```

Single entry point: `packages/api` + `packages/worker` share `packages/core`. The `NODE_MODE` variable determines what starts.

---

## 12. Planned evolutions (beyond V1)

| Topic               | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| Object storage      | Replace local storage with S3-compatible storage for uploaded files |
| Import formats      | CSV with lat/lon columns, GeoPackage                                |
| Export formats      | GeoJSON, CSV, GeoPackage, Shapefile                                 |
| CQL2 JSON           | JSON format support for CQL2 filters (`filter-lang=cql2-json`)      |
| CQL2 Temporal       | Full temporal filters (`T_AFTER`, `T_BEFORE`, `T_DURING`…)          |
| CQL2 Spatial (full) | All spatial operators (`S_CROSSES`, `S_OVERLAPS`, `S_TOUCHES`…)     |
| CRS by Reference    | Native exposure in CRS other than WGS84 via `?crs=...`              |
| Output formats      | CSV and GeoPackage in addition to GeoJSON                           |
| Tile caching        | MVT tile caching for improved performance                           |
| OGC API Tiles       | OGC API — Tiles standard conformance                                |
| Layer groups        | Combine multiple layers in a single response                        |
| Webhooks            | External notification at the end of an ingestion job                |
| Geo simplification  | Geometry simplification at import via mapshaper                     |

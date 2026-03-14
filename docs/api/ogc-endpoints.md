# OGC Endpoints

Sanson implements [OGC API — Features](https://ogcapi.ogc.org/features/) at the root URL. These endpoints are compatible with QGIS, ArcGIS, FME, and any OGC-compliant client.

## Landing page

```
GET /
```

Returns the API entry point with links to conformance, collections, and the OpenAPI spec.

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

## Conformance

```
GET /conformance
```

Declares the OGC conformance classes supported by Sanson:

| Conformance class        | Status      |
| ------------------------ | ----------- |
| Core                     | Implemented |
| GeoJSON                  | Implemented |
| OAS30                    | Implemented |
| Filter                   | Implemented |
| Features Filter          | Implemented |
| Queryables               | Implemented |
| CQL2 Text                | Implemented |
| CQL2 Basic               | Implemented |
| CQL2 Basic Spatial       | Implemented |
| CQL2 Advanced Comparison | Implemented |
| CQL2 JSON                | Planned     |
| CQL2 Temporal            | Planned     |
| CRS by Reference         | Planned     |

## OpenAPI specification

```
GET /api
```

Returns the auto-generated OpenAPI 3.0 specification. The admin UI includes an interactive API explorer powered by [Scalar](https://scalar.com) for testing endpoints directly from the browser.

## Collections

```
GET /collections
```

Lists all available feature collections (layers) across all workspaces.

```
GET /collections/{collectionId}
```

Returns metadata for a single collection.

**Collection ID format:** `{workspaceName}:{layerName}` (e.g., `default:regions`).

::: tip
The `:` separator follows the same convention used by GeoServer. If your proxy or WAF has issues with `:` in URLs, clients can encode it as `%3A`.
:::

### Response example

```json
{
  "id": "default:regions",
  "title": "regions",
  "extent": {
    "spatial": { "bbox": [[-5.1, 41.3, 9.6, 51.1]] }
  },
  "itemType": "feature",
  "crs": ["http://www.opengis.net/def/crs/OGC/1.3/CRS84"],
  "links": [
    { "href": "/collections/default:regions", "rel": "self", "type": "application/json" },
    {
      "href": "/collections/default:regions/items",
      "rel": "items",
      "type": "application/geo+json"
    },
    {
      "href": "/collections/default:regions/queryables",
      "rel": "queryables",
      "type": "application/schema+json"
    }
  ]
}
```

## Features

```
GET /collections/{collectionId}/items
```

Returns features as a GeoJSON FeatureCollection with pagination.

### Query parameters

| Parameter                | Description                                             | Example                           |
| ------------------------ | ------------------------------------------------------- | --------------------------------- |
| `limit`                  | Number of features per page (default: 25, max: 100)     | `?limit=50`                       |
| `offset`                 | Pagination offset (default: 0)                          | `?offset=100`                     |
| `bbox`                   | Bounding box filter                                     | `?bbox=2.2,48.8,2.5,49.0`         |
| `datetime`               | Temporal filter (requires configured `datetime_column`) | `?datetime=2024-01-01/2024-12-31` |
| `lat` + `lon`            | Point intersection filter                               | `?lat=48.85&lon=2.35`             |
| `lat` + `lon` + `radius` | Radius search in meters                                 | `?lat=48.85&lon=2.35&radius=1000` |
| `filter`                 | CQL2 Text expression                                    | `?filter=population>100000`       |
| `filter-lang`            | Filter language (`cql2-text`)                           | `?filter-lang=cql2-text`          |

See [CQL2 Filtering](/api/cql2-filtering) and [Spatial Filtering](/api/spatial-filtering) for details.

### Pagination

The response includes pagination links in both the JSON body and HTTP headers:

```json
{
  "type": "FeatureCollection",
  "features": [],
  "numberMatched": 142,
  "numberReturned": 25,
  "links": [
    { "href": "/collections/default:regions/items?offset=0&limit=25", "rel": "self" },
    { "href": "/collections/default:regions/items?offset=25&limit=25", "rel": "next" },
    { "href": "/collections/default:regions/items?offset=0&limit=25", "rel": "first" },
    { "href": "/collections/default:regions/items?offset=125&limit=25", "rel": "last" }
  ]
}
```

HTTP headers:

```
X-Total-Count: 142
Link: </collections/default:regions/items?offset=25&limit=25>; rel="next", ...
```

All query parameters (bbox, datetime, filter, etc.) are preserved in pagination links.

## Feature by ID

```
GET /collections/{collectionId}/items/{featureId}
```

Returns a single GeoJSON Feature by its identifier.

## Queryables

```
GET /collections/{collectionId}/queryables
```

Returns a JSON Schema describing the filterable properties of the collection. This enables GIS clients like QGIS to dynamically build filter UIs without prior knowledge of the data schema.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "/collections/default:regions/queryables",
  "type": "object",
  "title": "regions",
  "properties": {
    "geom": { "$ref": "https://geojson.org/schema/Geometry.json" },
    "nom": { "title": "nom", "type": "string" },
    "code": { "title": "code", "type": "string" }
  }
}
```

## Health check

```
GET /health
```

Returns the database connectivity status. Useful for load balancer health probes.

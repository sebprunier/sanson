# Vector Tiles (MVT)

Sanson serves Mapbox Vector Tiles (MVT) for each collection, enabling fast map rendering in web applications.

## Endpoint

```
GET /collections/{collectionId}/tiles/{z}/{x}/{y}.pbf
```

Returns a binary protobuf tile in `application/vnd.mapbox-vector-tile` format.

- **Empty tiles** return `204 No Content`
- **Caching**: `Cache-Control: public, max-age=3600` (1 hour)

## Tileset metadata

```
GET /collections/{collectionId}/tiles
```

Returns OGC-compliant tileset metadata for a collection, including the tile matrix set, bounding box, and templated tile URLs.

## Tile matrix sets

```
GET /tileMatrixSets
```

Lists available tile matrix sets. Sanson supports `WebMercatorQuad` (EPSG:3857).

```
GET /tileMatrixSets/WebMercatorQuad
```

Returns the full `WebMercatorQuad` definition with all zoom levels (0–24), scale denominators, and matrix dimensions.

## Compatible clients

- [MapLibre GL JS](https://maplibre.org)
- [Leaflet](https://leafletjs.com) (with vector tile plugins)
- [QGIS](https://qgis.org) (Vector Tiles layer)
- Any client that supports the MVT format

## PostGIS implementation

Tiles are generated on-the-fly using PostGIS:

- `ST_AsMVT` + `ST_AsMVTGeom` for tile encoding
- Extent: 4096 (standard tile resolution)
- Buffer: 256 pixels (prevents edge artifacts)
- Coordinate system: Web Mercator (EPSG:3857)
- Spatial filter uses the GIST index via `&&` for performance

## Usage with MapLibre GL JS

```js
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      sanson: {
        type: 'vector',
        tiles: ['http://localhost:3000/collections/default:regions/tiles/{z}/{x}/{y}.pbf'],
      },
    },
    layers: [
      {
        id: 'regions-fill',
        type: 'fill',
        source: 'sanson',
        'source-layer': 'regions',
        paint: {
          'fill-color': '#1B4F72',
          'fill-opacity': 0.4,
        },
      },
      {
        id: 'regions-outline',
        type: 'line',
        source: 'sanson',
        'source-layer': 'regions',
        paint: {
          'line-color': '#1B4F72',
          'line-width': 1,
        },
      },
    ],
  },
})
```

::: tip
The `source-layer` name matches the collection name in Sanson (e.g., `regions` for a collection named `regions`).
:::

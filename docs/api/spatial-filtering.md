# Spatial Filtering

Sanson provides several ways to filter features by their geographic location.

## Bounding box

```
GET /collections/{id}/items?bbox=minLon,minLat,maxLon,maxLat
```

Filters features whose geometry intersects the given bounding box. Uses the GIST spatial index for fast lookups.

**Example — features in the Paris area:**

```
GET /collections/default:communes/items?bbox=2.2,48.8,2.5,49.0
```

## Point intersection

```
GET /collections/{id}/items?lat={latitude}&lon={longitude}
```

Returns features whose geometry contains the given point. This is a non-standard convenience shortcut translated server-side to `ST_Intersects`.

**Example — find what's at the Eiffel Tower:**

```
GET /collections/default:communes/items?lat=48.8584&lon=2.2945
```

## Radius search

```
GET /collections/{id}/items?lat={latitude}&lon={longitude}&radius={meters}
```

Returns features within the given radius (in meters) of the point. Uses a `::geography` cast for accurate distance calculation regardless of the storage SRID.

**Example — features within 5 km of Lyon:**

```
GET /collections/default:communes/items?lat=45.764&lon=4.8357&radius=5000
```

## Datetime filter

```
GET /collections/{id}/items?datetime={value}
```

Filters features by a temporal property. Requires the collection to have a configured `datetime_column`.

| Format     | Description       | Example                           |
| ---------- | ----------------- | --------------------------------- |
| Instant    | Single date/time  | `?datetime=2024-01-01`            |
| Interval   | Start/end range   | `?datetime=2024-01-01/2024-12-31` |
| Open start | Everything before | `?datetime=../2024-12-31`         |
| Open end   | Everything after  | `?datetime=2024-01-01/..`         |

## Combining filters

All spatial and temporal filters can be combined with each other and with [CQL2 filters](/api/cql2-filtering):

```
GET /collections/default:communes/items
  ?bbox=2.0,48.5,3.0,49.5
  &filter=population > 10000
  &limit=50
```

```
GET /collections/default:events/items
  ?lat=48.85&lon=2.35&radius=2000
  &datetime=2024-06-01/2024-06-30
  &filter=category = 'concert'
```

All query parameters are preserved in pagination links.

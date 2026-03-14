# CQL2 Filtering

Sanson supports [OGC CQL2](https://docs.ogc.org/is/21-065r2/21-065r2.html) for filtering features by attributes and geometry. Both **CQL2 Text** and **CQL2 JSON** encodings are supported.

## Usage

Add the `filter` parameter to any features request:

```
GET /collections/{id}/items?filter=<expression>&filter-lang=cql2-text
GET /collections/{id}/items?filter=<json>&filter-lang=cql2-json
```

The `filter-lang` parameter is optional — `cql2-text` is the default.

## CQL2 Text operators

### Comparison

| Operator | Example              |
| -------- | -------------------- |
| `=`      | `population = 1000`  |
| `<>`     | `status <> 'closed'` |
| `<`      | `population < 5000`  |
| `<=`     | `area <= 100.5`      |
| `>`      | `population > 50000` |
| `>=`     | `elevation >= 1000`  |

### Logic

| Operator | Example                                   |
| -------- | ----------------------------------------- |
| `AND`    | `population > 1000 AND status = 'active'` |
| `OR`     | `type = 'city' OR type = 'town'`          |
| `NOT`    | `NOT status = 'closed'`                   |

### Text

| Operator    | Example                                |
| ----------- | -------------------------------------- |
| `LIKE`      | `name LIKE 'Par%'` (case-sensitive)    |
| `ILIKE`     | `name ILIKE 'par%'` (case-insensitive) |
| `NOT LIKE`  | `name NOT LIKE 'test%'` (negated)      |
| `NOT ILIKE` | `name NOT ILIKE '%paris%'` (negated)   |

Use `%` as a wildcard for zero or more characters.

### Null

| Operator      | Example                   |
| ------------- | ------------------------- |
| `IS NULL`     | `description IS NULL`     |
| `IS NOT NULL` | `description IS NOT NULL` |

### List

| Operator | Example                                |
| -------- | -------------------------------------- |
| `IN`     | `type IN ('city', 'town', 'village')`  |
| `NOT IN` | `status NOT IN ('closed', 'archived')` |

### Range

| Operator      | Example                             |
| ------------- | ----------------------------------- |
| `BETWEEN`     | `population BETWEEN 1000 AND 50000` |
| `NOT BETWEEN` | `elevation NOT BETWEEN 0 AND 100`   |

`BETWEEN` works with both numbers and strings.

### Spatial

| Operator       | Description                            |
| -------------- | -------------------------------------- |
| `S_INTERSECTS` | Geometry intersects the given geometry |
| `S_WITHIN`     | Geometry is within the given geometry  |
| `S_CONTAINS`   | Geometry contains the given geometry   |
| `S_TOUCHES`    | Geometries touch at their boundaries   |
| `S_CROSSES`    | Geometries cross each other            |
| `S_OVERLAPS`   | Geometries overlap                     |
| `S_EQUALS`     | Geometries are spatially equal         |
| `S_DISJOINT`   | Geometries are spatially disjoint      |

Spatial operators use WKT geometry literals:

```
S_INTERSECTS(geom, POINT(2.35 48.85))
S_WITHIN(geom, POLYGON((2.2 48.8, 2.5 48.8, 2.5 49.0, 2.2 49.0, 2.2 48.8)))
S_CONTAINS(geom, POINT(2.35 48.85))
S_DISJOINT(geom, POLYGON((0 0, 1 0, 1 1, 0 1, 0 0)))
```

### Temporal

| Operator       | Description                              |
| -------------- | ---------------------------------------- |
| `T_BEFORE`     | Property is before the given instant     |
| `T_AFTER`      | Property is after the given instant      |
| `T_EQUALS`     | Property equals the given instant        |
| `T_DURING`     | Property falls within the given interval |
| `T_INTERSECTS` | Property intersects the given interval   |
| `T_DISJOINT`   | Property is outside the given interval   |

Temporal operators use `TIMESTAMP()`, `DATE()`, or `INTERVAL()` literals:

```
T_BEFORE(updated, TIMESTAMP('2024-01-01T00:00:00Z'))
T_AFTER(created, DATE('2024-06-15'))
T_DURING(updated, INTERVAL('2024-01-01','2024-12-31'))
T_DURING(updated, INTERVAL('2024-01-01','..'))
T_DISJOINT(updated, INTERVAL('..','2024-06-01'))
```

Open-ended intervals use `'..'` for unbounded start or end.

## CQL2 JSON encoding

CQL2 JSON uses a structured `{"op": ..., "args": [...]}` format. Properties are referenced as `{"property": "name"}`.

### JSON operators

| CQL2 Text equivalent | JSON `op`                                          |
| -------------------- | -------------------------------------------------- |
| `=`, `<>`, `<`, etc. | Same (`=`, `<>`, `<`, `<=`, `>`, `>=`)             |
| `AND`, `OR`          | `and`, `or` (2+ args)                              |
| `NOT`                | `not` (1 arg)                                      |
| `LIKE`               | `like`                                             |
| `ILIKE`              | `like` with `casei` wrappers                       |
| `IS NULL`            | `isNull`                                           |
| `IN`                 | `in` (second arg is an array)                      |
| `BETWEEN`            | `between` (3 args)                                 |
| `S_INTERSECTS`, etc. | `s_intersects`, etc. (GeoJSON geometry)            |
| `T_BEFORE`, etc.     | `t_before`, etc. (`timestamp`, `date`, `interval`) |

### JSON examples

**Simple comparison:**

```json
{ "op": "=", "args": [{ "property": "name" }, "Paris"] }
```

**Combined filter:**

```json
{
  "op": "and",
  "args": [
    { "op": ">", "args": [{ "property": "population" }, 50000] },
    { "op": "=", "args": [{ "property": "departement" }, "75"] }
  ]
}
```

**Spatial filter with GeoJSON:**

```json
{
  "op": "s_intersects",
  "args": [{ "property": "geom" }, { "type": "Point", "coordinates": [2.35, 48.85] }]
}
```

**Case-insensitive text search:**

```json
{
  "op": "like",
  "args": [
    { "op": "casei", "args": [{ "property": "nom" }] },
    { "op": "casei", "args": ["saint%"] }
  ]
}
```

**List membership:**

```json
{ "op": "in", "args": [{ "property": "type" }, ["commune", "arrondissement"]] }
```

**Temporal filter:**

```json
{
  "op": "t_during",
  "args": [{ "property": "updated" }, { "interval": ["2024-01-01", "2024-12-31"] }]
}
```

## Examples

### Simple attribute filter

```
GET /collections/default:communes/items?filter=population > 100000
```

### Combined filters

```
GET /collections/default:communes/items
  ?filter=population > 50000 AND departement = '75'
```

### Spatial + attribute filter

```
GET /collections/default:communes/items
  ?bbox=2.2,48.8,2.5,49.0
  &filter=population > 10000
```

### Text search

```
GET /collections/default:communes/items?filter=nom ILIKE 'saint%'
```

### Full combined query

```
GET /collections/default:communes/items
  ?bbox=2.0,48.5,3.0,49.5
  &filter=population > 5000 AND type IN ('commune', 'arrondissement')
  &limit=50
```

## Column validation

Column names in CQL2 expressions are validated against the actual table schema. Using an unknown column name returns a `400 Bad Request` error.

Use the [Queryables](/api/ogc-endpoints#queryables) endpoint to discover available filterable properties for a collection.

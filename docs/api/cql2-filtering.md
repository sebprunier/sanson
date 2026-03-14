# CQL2 Filtering

Sanson supports [OGC CQL2 Text](https://docs.ogc.org/is/21-065r2/21-065r2.html) for filtering features by attributes and geometry.

## Usage

Add the `filter` parameter to any features request:

```
GET /collections/{id}/items?filter=<expression>&filter-lang=cql2-text
```

The `filter-lang` parameter is optional — `cql2-text` is the default (and currently only supported) value.

## Operators

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

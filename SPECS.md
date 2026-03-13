# Sanson — Spécifications

> Version 0.3 — Mars 2026

---

## 1. Pourquoi "Sanson" ?

**Nicolas Sanson** (1600–1667) est considéré comme le **père de la cartographie française**. Géographe du roi Louis XIII puis Louis XIV, il a fondé la première école française de cartographie et produit des centaines de cartes d'une précision remarquable pour son époque. Son travail a posé les bases méthodologiques de la cartographie moderne, que les Cassini ont ensuite prolongé au siècle suivant.

Comme Nicolas Sanson exposait et organisait la connaissance géographique de son temps, **Sanson** (le logiciel) expose et organise des données géographiques via des API modernes.

---

## 2. Vision

Sanson est un serveur géospatial open source dont l'objectif est d'exposer des données géographiques stockées dans PostgreSQL/PostGIS via des **API REST conformes OGC API — Features** et une **interface web d'administration**.

Principe fondateur : faire une chose, bien la faire. Sanson est un outil de publication de données géographiques — pas un outil d'API management, pas un outil de traitement de données, pas un outil de gestion d'environnements.

**Objectif de conformité :** Sanson implémente un sous-ensemble d'**OGC API — Features** (OGC 17-069r4), avec pour objectif la conformité complète aux classes de conformité Core, GeoJSON et CQL2. Cela garantit une compatibilité native avec les clients SIG standards (QGIS, ArcGIS, FME…) sans configuration particulière.

---

## 3. Hors scope

| Hors scope | Raison |
|---|---|
| API Management (authentification, quotas, rate limiting) | Responsabilité d'une autre brique (ex : Otoroshi, Kong) |
| Gestion d'environnements (recette, prod…) | Séparation des responsabilités |
| Protocoles OGC legacy (WMS, WFS, WCS, WPS) | Complexité disproportionnée vs. valeur — OGC API Features couvre le besoin |
| Traitement/analyse spatiale complexe | PostGIS / outils dédiés |
| Génération de tuiles raster | Hors périmètre |

---

## 4. Concepts métier

### Workspace
Namespace logique qui regroupe des layers. Permet d'organiser les données par thématique ou projet.
Exemple : `transport`, `risques`, `administratif`.

### Layer
Unité centrale de Sanson. Une layer représente un jeu de données géographiques exposé via l'API. Dans le vocabulaire OGC API Features, une layer correspond à une **Collection**. Elle est associée à :
- une table PostGIS source
- un workspace
- des métadonnées (nom, description, attribution)
- une configuration d'exposition (champs exposés, filtre par défaut)
- un style Mapbox GL optionnel (pour la visualisation)
- le SRID de stockage
- une bounding box et une étendue temporelle optionnelle (conformité OGC)

### Import
Opération d'ingestion d'un fichier de données géographiques (GeoJSON, Shapefile) pour créer ou alimenter une layer. Un import est traité de manière asynchrone par un nœud Worker. Son état est suivi via un Job.

### Job
Unité de travail asynchrone géré par la queue. Un job a un type (`ingest`), un état (`pending`, `running`, `completed`, `failed`), des paramètres, des logs d'exécution et des timestamps.

### Style
Un style Mapbox GL JSON associé à une layer, utilisé dans l'interface d'administration pour la visualisation cartographique.

---

## 5. Architecture technique

### 5.1 Stack

| Composant | Technologie |
|---|---|
| Backend (API + Worker) | Node.js 22 + TypeScript + Fastify |
| Base de données | PostgreSQL 16 + PostGIS 3.4 |
| Job queue | PostgreSQL + `pg-boss` |
| Ingestion géospatiale | `ogr2ogr` (CLI GDAL) + `COPY` PostgreSQL |
| Frontend admin | React + MapLibre GL JS + Vite |
| Organisation du code | Monorepo (`pnpm workspaces`) |
| Conteneurisation | Docker + Docker Compose |

### 5.2 Binaire unique — modes de nœud

Sanson se distribue sous la forme d'un **binaire unique**. Le comportement au démarrage est déterminé par la variable d'environnement `NODE_MODE`.

| Valeur | Comportement |
|---|---|
| `api` | Démarre uniquement le serveur HTTP (Fastify) |
| `worker` | Démarre uniquement le moteur d'ingestion (pg-boss worker) |
| `all` | Démarre les deux (défaut — pratique pour le développement et les petites installations) |

Ce pattern permet de scaler API nodes et Worker nodes indépendamment selon la charge.

```
                    ┌──────────────────────────────────────┐
                    │         Clients / Admin UI            │
                    └────────────┬─────────────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │         API Nodes (NODE_MODE=api)    │
              │         Node.js / Fastify            │
              │  /api, /tiles, /collections, /jobs   │
              └──────────────────┬──────────────────┘
                                 │
              ┌──────────────────▼──────────────────────────────┐
              │              PostgreSQL + PostGIS                │
              │                                                  │
              │  • données géo (tables par layer)                │
              │  • métadonnées (workspaces, layers, styles)      │
              │  • job queue (pg-boss)                           │
              └──────────────────┬──────────────────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │     Worker Nodes (NODE_MODE=worker)  │
              │                                      │
              │  1. dépile un job depuis la queue    │
              │  2. appelle ogr2ogr → CSV + EWKT     │
              │  3. COPY en masse → PostgreSQL        │
              │  4. met à jour métadonnées layer     │
              └──────────────────────────────────────┘
```

### 5.3 Pipeline d'ingestion

```
Fichier uploadé (.shp, .geojson)
        │
        ▼
ogr2ogr (détection SRID source, reprojection vers SRID cible)
        │
        ▼
Export CSV avec géométrie en EWKT
        │
        ▼
COPY en masse vers PostgreSQL (performant sur gros volumes)
        │
        ▼
Création/mise à jour de la table PostGIS et des métadonnées layer
```

### 5.4 Job queue

La queue de jobs s'appuie sur **PostgreSQL via `pg-boss`** — zéro infrastructure supplémentaire.

Le mécanisme repose sur `SELECT ... FOR UPDATE SKIP LOCKED` : plusieurs workers peuvent tourner en parallèle sans risque de traiter le même job deux fois. PostgreSQL gère la concurrence atomiquement.

Fonctionnalités pg-boss utilisées :
- Retry automatique en cas d'échec (configurable : nb de tentatives, délai)
- Expiration des jobs bloqués
- Historique des jobs

### 5.5 Stockage des fichiers uploadés

Phase initiale : upload direct sur le nœud qui reçoit la requête, stockage local, transmission au worker via le chemin de fichier enregistré dans le job.

Évolution prévue : stockage objet (compatible S3) pour découpler upload et traitement — sans changement de logique métier.

---

## 6. Gestion des SRID

| Phase | Comportement |
|---|---|
| **Import** | Détection automatique du SRID source via `ogr2ogr` / GDAL. Si non détectable, champ obligatoire dans l'UI. |
| **Stockage** | SRID configurable par layer. Défaut : **WGS84 (EPSG:4326)**. Stocker dans le SRID natif des données évite une reprojection à chaque import. |
| **Exposition API** | Toujours en **WGS84 (4326)** par défaut — requis par la conformité OGC API Features (GeoJSON). Paramètre optionnel `?crs=XXXX` (nom OGC : `crs`) pour exposer dans une autre projection — `ST_Transform` à la volée côté PostGIS. Note : si le CRS demandé diffère du SRID de stockage, la requête est plus coûteuse. |
| **Tuiles vectorielles** | Toujours en **Web Mercator (EPSG:3857)** — standard MVT. `ST_Transform` appliqué dans `ST_AsMVTGeom`. |

---

## 7. Conformité OGC API — Features

### Classes de conformité ciblées

| Classe de conformité | Description | Statut |
|---|---|---|
| **Core** | Landing page, conformance, collections, items, pagination | V1 |
| **GeoJSON** | Réponses en GeoJSON valide | V1 |
| **OAS30** | Spécification OpenAPI 3.0 auto-générée | V1 |
| **CQL2 Text** | Filtres attributaires en syntaxe texte | V1 |
| **CQL2 JSON** | Filtres attributaires en syntaxe JSON | V1 |
| **CQL2 Basic Spatial Operators** | Filtres spatiaux dans CQL2 (`S_INTERSECTS`, `S_WITHIN`…) | V1 |
| **CQL2 Temporal Operators** | Filtres temporels (`T_AFTER`, `T_BEFORE`, `T_DURING`…) | V2 |
| **CRS by Reference** | Exposition dans des CRS autres que WGS84 | V2 |

### Mapping des URLs OGC

```
GET /                                                   Landing page
GET /conformance                                        Conformance declaration
GET /api                                                OpenAPI specification
GET /collections                                        Liste des collections (tous workspaces)
GET /collections/{workspaceId}:{layerName}              Métadonnées d'une collection
GET /collections/{workspaceId}:{layerName}/items        Features (avec filtres, pagination)
GET /collections/{workspaceId}:{layerName}/items/{fid}  Feature par identifiant
```

> Le séparateur `:` entre workspace et layer dans l'identifiant de collection est une convention Sanson
> (ex: `risques:icpe`). Il est valide dans une URL encodée (`risques%3Aicpe`) et lisible en clair.

### Format des réponses — conformité OGC

#### Landing page (`GET /`)
```json
{
  "title": "Sanson",
  "description": "...",
  "links": [
    { "href": "/conformance", "rel": "conformance", "type": "application/json" },
    { "href": "/collections", "rel": "data",        "type": "application/json" },
    { "href": "/api",         "rel": "service-desc","type": "application/vnd.oai.openapi+json;version=3.0" }
  ]
}
```

#### Collection (`GET /collections/{id}`)
```json
{
  "id": "risques:icpe",
  "title": "ICPE",
  "description": "Installations classées pour la protection de l'environnement",
  "extent": {
    "spatial": { "bbox": [[-5.1, 41.3, 9.6, 51.1]] },
    "temporal": { "interval": [["2020-01-01T00:00:00Z", null]] }
  },
  "itemType": "feature",
  "crs": ["http://www.opengis.net/def/crs/OGC/1.3/CRS84"],
  "links": [
    { "href": "/collections/risques:icpe/items", "rel": "items", "type": "application/geo+json" }
  ]
}
```

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

---

## 8. Fonctionnalités

### 8.1 Ingestion de données

**Formats supportés :**
- GeoJSON (`.geojson`, `.json`)
- Shapefile (`.shp` + `.dbf` + `.prj` dans un `.zip`)

**Comportements :**
- Détection automatique du SRID source
- Reprojection vers le SRID de stockage cible (configurable, défaut 4326)
- Création automatique de la table PostGIS si elle n'existe pas
- Ajout de données si la table existe déjà (mode append)
- Suivi de progression en temps réel dans l'UI
- Historique des imports par layer (date, fichier source, nb de features, statut, logs d'erreur)

### 8.2 API de données — Paramètres de requête

#### Filtres géographiques (OGC Core)

| Paramètre | Description | Exemple |
|---|---|---|
| `bbox` | Bounding box `minLon,minLat,maxLon,maxLat` | `?bbox=2.2,48.8,2.5,49.0` |

#### Extensions géographiques Sanson (en CQL2)

| Paramètre | Description |
|---|---|
| `filter` avec `S_INTERSECTS` | Point exact ou rayon via `ST_Buffer` |
| `lat` + `lon` | Sucre syntaxique → traduit en `S_INTERSECTS(geom, POINT(lon lat))` |
| `lat` + `lon` + `radius` | Sucre syntaxique → traduit en filtre `ST_Buffer` (mètres) |

#### Filtre temporel (OGC Core)

| Paramètre | Description | Exemple |
|---|---|---|
| `datetime` | Instant ou intervalle ISO 8601 | `?datetime=2024-01-01` ou `?datetime=2023-01-01/2024-01-01` |

#### Filtres attributaires — CQL2 (OGC CQL2)

| Paramètre | Description |
|---|---|
| `filter` | Expression CQL2 Text ou JSON |
| `filter-lang` | `cql2-text` (défaut) ou `cql2-json` |

**Sous-ensemble CQL2 Text supporté en V1 :**
- Comparaison : `=`, `<>`, `<`, `<=`, `>`, `>=`
- Logique : `AND`, `OR`, `NOT`
- Texte : `LIKE`, `ILIKE`
- Nullité : `IS NULL`, `IS NOT NULL`
- Liste : `IN ('val1', 'val2')`
- Opérateurs spatiaux : `S_INTERSECTS`, `S_WITHIN`, `S_CONTAINS`

Combinaison géo + attributaire :
```
GET /collections/risques:icpe/items
  ?bbox=2.2,48.8,2.5,49.0
  &filter=regime='Seveso' AND etat='En activité'
  &filter-lang=cql2-text
```

#### Pagination (OGC Core)

| Paramètre | Défaut | Max |
|---|---|---|
| `limit` | `25` | `100` |
| `offset` | `0` | — |

Les liens `next` / `prev` dans la réponse permettent la navigation sans gérer `offset` manuellement.

#### Autres paramètres

| Paramètre | Description |
|---|---|
| `f` | Format de sortie : `json` (défaut, GeoJSON), `csv`, `gpkg` |
| `crs` | CRS de la géométrie en sortie (défaut : WGS84) |

### 8.3 Feature par identifiant

```
GET /collections/{workspaceId}:{layerName}/items/{fid}
```

### 8.4 Tuiles vectorielles (MVT)

```
GET /collections/{workspaceId}:{layerName}/tiles/{z}/{x}/{y}.pbf
```

Format **Mapbox Vector Tiles** (`.pbf`). Compatible MapLibre GL JS, Leaflet + plugins, QGIS, etc.

Implémentation : `ST_AsMVT` + `ST_AsMVTGeom` avec `ST_TileEnvelope`. Géométrie transformée en EPSG:3857.

### 8.5 Jobs (API d'administration)

```
POST /api/jobs/ingest           Créer un job d'ingestion (multipart : fichier + config)
GET  /api/jobs/{jobId}          État et logs d'un job
GET  /api/jobs                  Historique des jobs (filtrable par statut, layer, workspace)
```

---

## 9. Interface web d'administration

Application React mono-page, servie par les nœuds API.

### Dashboard
- Nombre de workspaces, layers, features totales
- État de la connexion PostgreSQL/PostGIS
- Jobs récents (dernières 24h) avec leur statut

### Gestion des Workspaces et Layers
- Liste des workspaces → liste des layers par workspace
- Création / édition / suppression de workspace
- Création / édition / suppression de layer
  - Nom, description, attribution
  - SRID de stockage
  - Champs exposés (sélection, renommage)
  - Champ datetime (pour le filtre temporel OGC)
  - Style Mapbox GL (éditeur JSON)

### Exploration d'une layer
- **Vue carte** : visualisation des données avec MapLibre GL, style configurable
- **Vue tableau** : exploration tabulaire avec tri et recherche
- **Vue schéma** : liste des champs, types, statistiques basiques (min, max, nulls)

### Import de données
- Upload de fichier (GeoJSON ou Shapefile ZIP)
- Sélection du workspace et de la layer cible (existante ou nouvelle)
- Choix du SRID cible (défaut : 4326)
- Suivi de progression en temps réel
- Logs d'exécution

### Explorateur API
- Interface Scalar sur la spécification OpenAPI 3.0 générée automatiquement par Fastify
- Permet de tester tous les endpoints OGC directement depuis le navigateur

---

## 10. Modèle de données — tables de métadonnées

```sql
-- Workspaces
CREATE TABLE sanson_workspaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Layers (= Collections OGC)
CREATE TABLE sanson_layers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID REFERENCES sanson_workspaces(id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    description       TEXT,
    attribution       TEXT,
    table_name        VARCHAR(200) NOT NULL,       -- table PostGIS associée
    geometry_column   VARCHAR(100) DEFAULT 'geom',
    id_column         VARCHAR(100) DEFAULT 'id',
    datetime_column   VARCHAR(100),                -- colonne pour le filtre ?datetime OGC
    srid              INTEGER DEFAULT 4326,
    bbox              JSONB,                        -- [minLon, minLat, maxLon, maxLat]
    temporal_extent   JSONB,                        -- ["2020-01-01T00:00:00Z", null]
    exposed_fields    JSONB,                        -- [{source: 'nom', alias: 'name'}, ...]
    style             JSONB,                        -- Mapbox GL Style JSON
    feature_count     BIGINT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE(workspace_id, name)
);

-- Historique des imports
CREATE TABLE sanson_import_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layer_id      UUID REFERENCES sanson_layers(id),
    job_id        UUID,                              -- référence pg-boss
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

---

## 11. Organisation du code (monorepo)

```
sanson/
├── packages/
│   ├── core/           Types partagés, utils DB, modèles, parseur CQL2
│   ├── api/            Serveur Fastify, routes OGC + admin, handlers
│   └── worker/         pg-boss workers, pipeline ogr2ogr
├── apps/
│   └── admin/          Frontend React + MapLibre GL
├── docker/
│   ├── Dockerfile
│   └── compose.yml
├── scripts/
│   └── init.sql        Création des tables de métadonnées
└── SPECS.md
```

Point d'entrée unique : `packages/api` + `packages/worker` partagent `packages/core`. La variable `NODE_MODE` détermine ce qui démarre.

---

## 12. Évolutions prévues (hors V1)

| Sujet | Description |
|---|---|
| Stockage objet | Remplacement du stockage local par un stockage S3-compatible pour les fichiers uploadés |
| Formats d'import | CSV avec colonnes lat/lon, GeoPackage |
| Tile caching | Cache des tuiles MVT pour améliorer les performances |
| Layer groups | Combiner plusieurs layers dans une même réponse |
| Webhooks | Notification externe à la fin d'un job d'ingestion |
| Export | Téléchargement des données d'une layer (GeoJSON, Shapefile, GeoPackage) |
| OGC API Tiles | Conformité au standard OGC API — Tiles (complément à notre endpoint MVT) |
| CQL2 Temporal | Filtres temporels complets (`T_AFTER`, `T_BEFORE`, `T_DURING`…) |
| CRS by Reference | Exposition native dans des CRS autres que WGS84 |

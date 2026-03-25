---
layout: home

hero:
  name: Sanson
  text: Open Source Geospatial Server
  tagline: OGC API Features compliant — powered by PostgreSQL + PostGIS
  image:
    src: /logo.png
    alt: Sanson
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/ogc-endpoints

features:
  - title: OGC API Features
    details: Native compatibility with QGIS, ArcGIS, FME, and any OGC-compliant client. No plugin or special configuration needed.
  - title: CQL2 Filtering
    details: Filter features by attributes and geometry using the OGC CQL2 Text standard — comparison, logic, text, spatial operators.
  - title: Async Data Import
    details: Background GeoJSON import with progress tracking, batch inserts, and structured logs. Supports gzip-compressed files.
  - title: Vector Tiles (MVT)
    details: Mapbox Vector Tiles via PostGIS ST_AsMVT. Compatible with MapLibre GL JS, Leaflet, and QGIS.
  - title: Web Admin UI
    details: Dashboard, workspace and collection management, interactive map and table views, data import with live progress, API explorer.
  - title: PostgreSQL-native
    details: Zero extra infrastructure. PostgreSQL handles data, spatial queries, and the job queue (pg-boss). No Redis, no RabbitMQ.
---

> Named after **Nicolas Sanson** (1600--1667), father of French cartography and royal geographer to Louis XIII and Louis XIV.

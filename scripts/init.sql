-- Sanson metadata tables
-- Run once against a fresh database to bootstrap the schema.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Workspaces
CREATE TABLE IF NOT EXISTS sanson_workspaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Collections (OGC API Features collections)
CREATE TABLE IF NOT EXISTS sanson_collections (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      UUID REFERENCES sanson_workspaces(id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    description       TEXT,
    attribution       TEXT,
    table_name        VARCHAR(200) NOT NULL,
    geometry_column   VARCHAR(100) DEFAULT 'geom',
    geometry_type     VARCHAR(50),
    id_column         VARCHAR(100) DEFAULT 'id',
    datetime_column   VARCHAR(100),
    srid              INTEGER DEFAULT 4326,
    bbox              JSONB,
    temporal_extent   JSONB,
    exposed_fields    JSONB,
    style             JSONB,
    feature_count     BIGINT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE(workspace_id, name)
);

-- Default workspace (always present, used when no specific workspace is needed)
INSERT INTO sanson_workspaces (name, description)
VALUES ('default', 'Default workspace')
ON CONFLICT DO NOTHING;

-- Import history (also serves as job tracking table)
CREATE TABLE IF NOT EXISTS sanson_import_history (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id      UUID REFERENCES sanson_collections(id) ON DELETE CASCADE,
    job_id             UUID,
    source_file        VARCHAR(500),
    source_srid        INTEGER,
    target_srid        INTEGER,
    feature_count      BIGINT,
    total_features     BIGINT,
    imported_features  BIGINT DEFAULT 0,
    progress           SMALLINT DEFAULT 0,
    status             VARCHAR(20) DEFAULT 'pending',
    error              TEXT,
    logs               JSONB DEFAULT '[]'::jsonb,
    duration_ms        INTEGER,
    created_at         TIMESTAMPTZ DEFAULT now(),
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ
);

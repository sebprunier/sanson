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
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID REFERENCES sanson_workspaces(id) ON DELETE CASCADE,
    name                VARCHAR(100) NOT NULL,
    description         TEXT,
    attribution         TEXT,
    table_name          VARCHAR(200) NOT NULL,
    geometry_column     VARCHAR(100) DEFAULT 'geom',
    geometry_type       VARCHAR(50),
    id_column           VARCHAR(100) DEFAULT 'id',
    datetime_column     VARCHAR(100),
    srid                INTEGER DEFAULT 4326,
    bbox                JSONB,
    temporal_extent     JSONB,
    exposed_fields      JSONB,
    style               JSONB,
    default_center_lon  DOUBLE PRECISION,
    default_center_lat  DOUBLE PRECISION,
    default_zoom        DOUBLE PRECISION,
    feature_count       BIGINT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(workspace_id, name)
);

-- Backfill columns for databases initialized before these were added
ALTER TABLE sanson_collections ADD COLUMN IF NOT EXISTS default_center_lon DOUBLE PRECISION;
ALTER TABLE sanson_collections ADD COLUMN IF NOT EXISTS default_center_lat DOUBLE PRECISION;
ALTER TABLE sanson_collections ADD COLUMN IF NOT EXISTS default_zoom       DOUBLE PRECISION;

-- Default workspace (always present, used when no specific workspace is needed)
INSERT INTO sanson_workspaces (name, description)
VALUES ('default', 'Default workspace')
ON CONFLICT DO NOTHING;

-- Configuration (key/value settings, editable from admin UI)
CREATE TABLE IF NOT EXISTS sanson_config (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT NOT NULL,
    category    VARCHAR(50) NOT NULL,
    label       VARCHAR(200) NOT NULL,
    description TEXT,
    restart     BOOLEAN DEFAULT false,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO sanson_config (key, value, category, label, description, restart) VALUES
  ('upload.max_file_size_mb',    '1024',  'upload',  'Max file size (MB)',              'Maximum upload file size in megabytes',                          true),
  ('import.batch_size',          '500',   'import',  'Batch size',                      'Number of features inserted per batch during import',            false),
  ('import.csv_inference_rows',  '100',   'import',  'CSV type inference rows',         'Number of rows sampled to infer column types for CSV imports',   false),
  ('import.default_srid',        '4326',  'import',  'Default SRID',                    'Default coordinate reference system for imports',                false),
  ('jobs.retry_limit',           '3',     'jobs',    'Retry limit',                     'Maximum number of retries for failed jobs',                      true),
  ('jobs.retry_delay_seconds',   '30',    'jobs',    'Retry delay (seconds)',            'Delay between job retries in seconds',                           true),
  ('jobs.expire_hours',          '2',     'jobs',    'Expiration (hours)',               'Time before a running job is considered expired',                true),
  ('jobs.archive_days',          '7',     'jobs',    'Archive after (days)',             'Number of days before completed jobs are archived',              true),
  ('tiles.cache_ttl_seconds',    '3600',  'tiles',   'Cache TTL (seconds)',             'Cache-Control max-age for vector tiles',                         false)
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

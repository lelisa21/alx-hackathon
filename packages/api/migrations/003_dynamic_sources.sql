ALTER TABLE passage
  ADD COLUMN source_id TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN source_resource_id TEXT;

UPDATE passage
SET source_resource_id = lesson_id
WHERE source_resource_id IS NULL;

ALTER TABLE passage
  ALTER COLUMN source_resource_id SET NOT NULL,
  DROP CONSTRAINT passage_pkey,
  DROP CONSTRAINT passage_content_version_id_fkey,
  ADD CONSTRAINT passage_content_version_id_fkey
    FOREIGN KEY (content_version_id)
    REFERENCES content_version(id)
    ON DELETE CASCADE,
  ADD PRIMARY KEY (content_version_id, id);

CREATE INDEX passage_source_resource_idx
  ON passage (content_version_id, source_id, source_resource_id);

CREATE TABLE source_generation (
  id TEXT PRIMARY KEY REFERENCES content_version(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('full', 'incremental')),
  status TEXT NOT NULL CHECK (status IN ('staging', 'active', 'retired')),
  snapshot_revision TEXT,
  cursor TEXT,
  discovered INTEGER NOT NULL DEFAULT 0 CHECK (discovered >= 0),
  indexed INTEGER NOT NULL DEFAULT 0 CHECK (indexed >= 0),
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX source_generation_single_staging
  ON source_generation (source_id)
  WHERE status = 'staging';

CREATE INDEX source_generation_source_created_idx
  ON source_generation (source_id, created_at DESC);

CREATE TABLE source_resource_revision (
  generation_id TEXT NOT NULL
    REFERENCES source_generation(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  language TEXT,
  media_type TEXT NOT NULL,
  title TEXT,
  relations JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (generation_id, source_id, resource_id)
);

CREATE TABLE active_source_generation (
  source_id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL UNIQUE
    REFERENCES source_generation(id) ON DELETE CASCADE
);

WITH latest AS (
  SELECT id
  FROM content_version
  ORDER BY created_at DESC, id DESC
  LIMIT 1
)
INSERT INTO source_generation (
  id,
  source_id,
  mode,
  status,
  completed_at
)
SELECT id, 'legacy', 'full', 'active', now()
FROM latest;

INSERT INTO active_source_generation (source_id, generation_id)
SELECT source_id, id
FROM source_generation
WHERE source_id = 'legacy' AND status = 'active';

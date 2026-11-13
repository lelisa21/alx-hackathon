-- Pseudonymous learner sessions; no learner name or contact information.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel TEXT NOT NULL CHECK (channel IN ('web', 'telegram', 'sms', 'api')),
  lang TEXT NOT NULL,
  simple BOOLEAN NOT NULL DEFAULT FALSE,
  data_saver BOOLEAN NOT NULL DEFAULT FALSE,
  cloud_ok BOOLEAN NOT NULL DEFAULT TRUE,
  consent_version TEXT
);
CREATE INDEX session_last_seen_idx ON session (last_seen_at);

-- Session messages; learner text is removed first by the retention job.
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  client_msg_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('learner', 'dimts')),
  text TEXT,
  lang TEXT NOT NULL,
  kind TEXT NOT NULL,
  citations JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, client_msg_id)
);
CREATE INDEX message_session_idx ON message (session_id, created_at);

-- Ingest versions allow passages and answer caches to be replaced together.
CREATE TABLE content_version (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_hash TEXT NOT NULL
);

-- Grounded course and job source passages.
CREATE TABLE passage (
  id TEXT PRIMARY KEY,
  content_version_id TEXT NOT NULL REFERENCES content_version(id),
  lesson_id TEXT NOT NULL,
  lesson_title TEXT NOT NULL,
  section_title TEXT,
  anchor TEXT,
  url TEXT NOT NULL,
  lang TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('course', 'job')),
  ts_start REAL,
  text TEXT NOT NULL,
  text_norm TEXT NOT NULL,
  grams TEXT[] NOT NULL
);
CREATE INDEX passage_grams_gin ON passage USING GIN (grams);
CREATE INDEX passage_type_idx ON passage (source_type);

-- Learner requests for human help and helper conversations.
CREATE TABLE help_request (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'claimed', 'closed')),
  include_summary BOOLEAN NOT NULL DEFAULT TRUE,
  summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);
CREATE INDEX help_status_idx ON help_request (status, created_at);

CREATE TABLE help_message (
  id TEXT PRIMARY KEY,
  help_request_id TEXT NOT NULL REFERENCES help_request(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('learner', 'helper')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Temporary screen-share pictures are stored in the database, not local disk.
CREATE TABLE help_image (
  id TEXT PRIMARY KEY,
  help_request_id TEXT NOT NULL REFERENCES help_request(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  data BYTEA NOT NULL CHECK (octet_length(data) <= 2097152),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consented job alert subscriptions with application-encrypted contact data.
CREATE TABLE subscription (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'sms')),
  contact_enc BYTEA NOT NULL,
  lang TEXT NOT NULL,
  job_type TEXT,
  region TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ
);

-- Imported schema.org JobPosting records.
CREATE TABLE job (
  id TEXT PRIMARY KEY,
  posting JSONB NOT NULL,
  title TEXT NOT NULL,
  region TEXT,
  job_type TEXT,
  deadline DATE,
  accommodations_offered TEXT[],
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevents duplicate delivery of a job alert.
CREATE TABLE alert_sent (
  subscription_id TEXT NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, job_id)
);

-- Learner-approved job accommodation requests contain choices, not diagnoses.
CREATE TABLE accommodation_request (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES job(id) ON DELETE SET NULL,
  needs JSONB NOT NULL,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  relay_token TEXT
);

-- Records consent notice metadata without recording its content.
CREATE TABLE consent_log (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Anonymous helpfulness counts by topic, language, and period.
CREATE TABLE feedback_counter (
  topic_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  period DATE NOT NULL,
  helpful INTEGER NOT NULL DEFAULT 0,
  unhelpful INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (topic_id, lang, period)
);

-- Anonymous question and not-found counts by topic, language, and period.
CREATE TABLE insight_aggregate (
  topic_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  period DATE NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  notfound_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (topic_id, lang, period)
);

-- Host integration keys are stored as hashes; origins restrict browser use.
CREATE TABLE host_key (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  origins TEXT[] NOT NULL DEFAULT '{}'
);

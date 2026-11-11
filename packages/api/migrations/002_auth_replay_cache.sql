-- Store only hashes of one-time learner session and resume credentials.
ALTER TABLE session ADD COLUMN token_hash TEXT;
ALTER TABLE session ADD COLUMN resume_hash TEXT;
ALTER TABLE session ADD COLUMN contact_hmac TEXT;
CREATE UNIQUE INDEX session_contact_idx
  ON session (channel, contact_hmac)
  WHERE contact_hmac IS NOT NULL;

-- Replies point to learner client message ids and store the exact replay payload.
ALTER TABLE message ADD COLUMN reply_to TEXT;
ALTER TABLE message ADD COLUMN reply JSONB;
CREATE UNIQUE INDEX message_reply_to_idx
  ON message (session_id, reply_to)
  WHERE reply_to IS NOT NULL;

-- Staff helper credentials are hashed; staff display names are not learner data.
CREATE TABLE helper (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  langs TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE help_request ADD COLUMN helper_id TEXT REFERENCES helper(id);

-- Optional grounded-answer cache, cleared on content re-ingest and by retention.
CREATE TABLE answer_cache (
  cache_key TEXT PRIMARY KEY,
  reply JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX answer_cache_age_idx ON answer_cache (created_at);

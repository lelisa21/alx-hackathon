-- FR-JOB-01--10: consent-bound encrypted contacts and private draft state.
ALTER TABLE host_key ADD COLUMN key_type TEXT NOT NULL DEFAULT 'public'
  CHECK (key_type IN ('public', 'secret'));

ALTER TABLE job ADD COLUMN lang TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN employer_email TEXT;

ALTER TABLE subscription ALTER COLUMN contact_enc DROP NOT NULL,
  ADD COLUMN contact_hash TEXT,
  ADD COLUMN client_request_id TEXT,
  ADD COLUMN consent_expires_at TIMESTAMPTZ,
  ADD COLUMN notice_version TEXT,
  DROP CONSTRAINT subscription_session_id_fkey,
  ADD CONSTRAINT subscription_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES session(id) ON DELETE CASCADE;
-- Legacy rows never had verifiable consent: revoke rather than infer it.
UPDATE subscription SET stopped_at = COALESCE(stopped_at, now()), contact_enc = NULL;
CREATE UNIQUE INDEX subscription_request_idx ON subscription(session_id, client_request_id);
CREATE INDEX subscription_active_idx ON subscription(consent_expires_at) WHERE stopped_at IS NULL;

CREATE TABLE job_digest (
  subscription_id TEXT NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  job_ids TEXT[] NOT NULL,
  job_snapshot JSONB NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'skipped')),
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (subscription_id, day)
);

ALTER TABLE accommodation_request
  ADD COLUMN client_request_id TEXT,
  ADD COLUMN lang TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'sent', 'cancelled')),
  ADD COLUMN private_enc BYTEA,
  ADD COLUMN delivery_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  DROP CONSTRAINT accommodation_request_session_id_fkey,
  ADD CONSTRAINT accommodation_request_session_id_fkey FOREIGN KEY(session_id)
    REFERENCES session(id) ON DELETE CASCADE;
-- Existing needs could contain private free text; old drafts are invalidated.
UPDATE accommodation_request SET needs = '[]'::jsonb, status = 'cancelled';
CREATE UNIQUE INDEX accommodation_request_request_idx ON accommodation_request(session_id, client_request_id);
CREATE UNIQUE INDEX accommodation_approved_interview_idx ON accommodation_request(session_id,job_id) WHERE status='approved';

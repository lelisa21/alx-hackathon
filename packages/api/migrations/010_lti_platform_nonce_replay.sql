-- P10 LTI 1.3: Platform configuration, nonce tracking, and replay prevention
CREATE TABLE lti_platform (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  auth_login_url TEXT NOT NULL,
  auth_token_url TEXT NOT NULL,
  jwks_uri TEXT NOT NULL,
  deployment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lti_nonce_state (
  state TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES lti_platform(id),
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lti_nonce_state_expiry_idx ON lti_nonce_state(expires_at);
CREATE INDEX lti_nonce_state_platform_idx ON lti_nonce_state(platform_id);

CREATE TABLE lti_nonce_used (
  nonce TEXT PRIMARY KEY,
  session_id TEXT REFERENCES session(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lti_token_replay (
  token_hash TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES lti_platform(id),
  session_id TEXT REFERENCES session(id) ON DELETE CASCADE,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lti_token_replay_expiry_idx ON lti_token_replay(detected_at);

-- LTI context is stored on the session for audit and role-based insights access
ALTER TABLE session ADD COLUMN IF NOT EXISTS lti_context JSONB;
CREATE INDEX session_lti_context_idx ON session USING gin(lti_context) WHERE lti_context IS NOT NULL;

-- Clean up expired LTI state/nonce/replay records (called from retention)
CREATE FUNCTION cleanup_expired_lti_records() RETURNS void LANGUAGE sql AS $$
  DELETE FROM lti_nonce_state WHERE expires_at < now();
  DELETE FROM lti_nonce_used WHERE used_at < now() - interval '24 hours';
  DELETE FROM lti_token_replay WHERE detected_at < now() - interval '24 hours';
$$;

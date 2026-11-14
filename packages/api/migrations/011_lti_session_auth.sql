ALTER TABLE session
  DROP CONSTRAINT IF EXISTS session_channel_check;

ALTER TABLE session
  ADD CONSTRAINT session_channel_check
  CHECK (channel IN ('web', 'telegram', 'sms', 'api', 'lti'));

ALTER TABLE session
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE lti_nonce_state
  DROP CONSTRAINT IF EXISTS lti_nonce_state_platform_id_fkey;

ALTER TABLE lti_token_replay
  DROP CONSTRAINT IF EXISTS lti_token_replay_platform_id_fkey;

CREATE INDEX IF NOT EXISTS session_lti_token_hash_idx
  ON session (token_hash)
  WHERE channel = 'lti' AND token_hash IS NOT NULL;

-- FR-SMS-05--11: durable pseudonymous conversations, caps, and delivery metadata.
-- The STOP tombstone intentionally outlives session and encrypted text retention.
CREATE TABLE sms_conversation (
  phone_hash TEXT PRIMARY KEY CHECK(length(phone_hash)=64),
  session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  stopped_at TIMESTAMPTZ,
  -- Only the canned localized confirmation and delivery metadata; no contact or
  -- learner text. Keeping its fixed payload makes crash recovery idempotent.
  stop_delivery JSONB,
  day DATE NOT NULL,
  outbound_count INTEGER NOT NULL DEFAULT 0 CHECK(outbound_count>=0),
  window_at BIGINT NOT NULL DEFAULT 0,
  window_count INTEGER NOT NULL DEFAULT 0 CHECK(window_count>=0),
  private_enc BYTEA,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sms_session_idx ON sms_conversation(session_id);
CREATE TABLE sms_delivery (
  id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL REFERENCES sms_conversation(phone_hash) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('queued','sent','delivered','failed')),
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sms_delivery_expiry_idx ON sms_delivery(created_at);
-- Session erasure must erase continuation, replay responses, and pending private
-- state too; retain only the HMAC STOP tombstone and minimal anti-abuse counters.
CREATE FUNCTION clear_sms_session_private() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM sms_delivery WHERE phone_hash IN (SELECT phone_hash FROM sms_conversation WHERE session_id=OLD.id);
  UPDATE sms_conversation SET private_enc=NULL WHERE session_id=OLD.id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER sms_session_private BEFORE DELETE ON session FOR EACH ROW EXECUTE FUNCTION clear_sms_session_private();

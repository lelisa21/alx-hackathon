-- FR-TG-08/10/12: HMAC-only continuity, encrypted 24-hour channel state,
-- bounded replay/rate metadata and permanent alert STOP tombstones.
CREATE TABLE telegram_conversation (
 contact_hash TEXT PRIMARY KEY CHECK(length(contact_hash)=64),
 session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
 lang TEXT NOT NULL DEFAULT 'en', stopped_at TIMESTAMPTZ,
 last_update BIGINT NOT NULL DEFAULT -1,
 replay_cutoff BIGINT NOT NULL DEFAULT -1,
 window_at BIGINT NOT NULL DEFAULT 0,
 window_count INTEGER NOT NULL DEFAULT 0 CHECK(window_count>=0),
 private_enc BYTEA, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX telegram_session_idx ON telegram_conversation(session_id);
CREATE INDEX telegram_expiry_idx ON telegram_conversation(expires_at);
CREATE TABLE telegram_delivery (
 contact_hash TEXT NOT NULL REFERENCES telegram_conversation(contact_hash) ON DELETE CASCADE,
 key_hash TEXT NOT NULL CHECK(length(key_hash)=64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(contact_hash,key_hash)
);
CREATE INDEX telegram_delivery_expiry_idx ON telegram_delivery(created_at);
CREATE FUNCTION clear_telegram_session_private() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM telegram_delivery WHERE contact_hash IN (SELECT contact_hash FROM telegram_conversation WHERE session_id=OLD.id);
 UPDATE telegram_conversation SET private_enc=NULL,replay_cutoff=GREATEST(replay_cutoff,last_update),expires_at=now()+interval '24 hours' WHERE session_id=OLD.id;
 RETURN OLD;
END;
$$;
CREATE TRIGGER telegram_session_private BEFORE DELETE ON session FOR EACH ROW EXECUTE FUNCTION clear_telegram_session_private();

-- All P06 subscription entry points honor channel STOP, including web forms.
-- The short contact transaction is independent of the long-lived chat lock.
CREATE FUNCTION prevent_telegram_alert_reactivation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.channel='telegram' AND NEW.contact_hash IS NOT NULL AND NEW.stopped_at IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.contact_hash,809));
  IF EXISTS (SELECT 1 FROM telegram_conversation WHERE contact_hash=NEW.contact_hash AND stopped_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Telegram alerts stopped' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER telegram_alert_stop BEFORE INSERT OR UPDATE ON subscription FOR EACH ROW EXECUTE FUNCTION prevent_telegram_alert_reactivation();

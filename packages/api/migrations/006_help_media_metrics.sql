-- Public first name is deliberately opted in; existing staff display_name stays private.
ALTER TABLE helper ADD COLUMN public_display_name TEXT
  CHECK (public_display_name IS NULL OR length(public_display_name) BETWEEN 1 AND 40);
ALTER TABLE help_request ADD COLUMN resolved BOOLEAN;
CREATE INDEX help_image_expiry_idx ON help_image(created_at);

-- One anonymous aggregate; no request, helper, session, language or content key.
CREATE TABLE help_service_metric (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  closed_count BIGINT NOT NULL DEFAULT 0,
  resolved_count BIGINT NOT NULL DEFAULT 0,
  unresolved_count BIGINT NOT NULL DEFAULT 0,
  total_wait_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_resolution_ms DOUBLE PRECISION NOT NULL DEFAULT 0
);
INSERT INTO help_service_metric(singleton) VALUES(TRUE);

CREATE FUNCTION help_request_closed_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    DELETE FROM help_image WHERE help_request_id = NEW.id;
    DELETE FROM help_message WHERE help_request_id = NEW.id;
    NEW.summary := NULL;
    UPDATE help_service_metric SET
      closed_count = closed_count + 1,
      resolved_count = resolved_count + CASE WHEN NEW.resolved IS TRUE THEN 1 ELSE 0 END,
      unresolved_count = unresolved_count + CASE WHEN NEW.resolved IS FALSE THEN 1 ELSE 0 END,
      total_wait_ms = total_wait_ms + CASE WHEN NEW.claimed_at IS NULL THEN 0 ELSE GREATEST(0,EXTRACT(EPOCH FROM NEW.claimed_at-NEW.created_at)*1000) END,
      total_resolution_ms = total_resolution_ms + CASE WHEN NEW.claimed_at IS NULL THEN 0 ELSE GREATEST(0,EXTRACT(EPOCH FROM NEW.closed_at-NEW.claimed_at)*1000) END
    WHERE singleton;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER help_request_closed_cleanup BEFORE UPDATE OF status ON help_request
FOR EACH ROW EXECUTE FUNCTION help_request_closed_cleanup();

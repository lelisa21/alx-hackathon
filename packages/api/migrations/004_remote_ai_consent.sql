ALTER TABLE session ALTER COLUMN cloud_ok SET DEFAULT FALSE;

UPDATE session
SET cloud_ok = FALSE,
    consent_version = NULL;

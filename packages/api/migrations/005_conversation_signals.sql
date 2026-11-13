-- Session-only bounded state; feedback aggregates never contain session IDs.
ALTER TABLE session ADD COLUMN negative_feedback_streak SMALLINT NOT NULL DEFAULT 0
  CHECK (negative_feedback_streak BETWEEN 0 AND 2);

-- Support the two-reply signal without reading transcript text.
CREATE INDEX message_reply_kind_session_idx
  ON message (session_id, created_at DESC, id DESC) INCLUDE (kind)
  WHERE role = 'dimts';

CREATE TABLE help_request_block (
  helper_id TEXT NOT NULL REFERENCES helper(id) ON DELETE CASCADE,
  help_request_id TEXT NOT NULL REFERENCES help_request(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (helper_id, help_request_id)
);

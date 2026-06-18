CREATE TABLE IF NOT EXISTS service_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_state_updated_at_ms
  ON service_state (updated_at_ms);

CREATE TABLE IF NOT EXISTS service_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_state_updated_at_ms
  ON service_state (updated_at_ms);

CREATE TABLE IF NOT EXISTS makers_vaults (
  vault_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  owner_address TEXT NOT NULL,
  quote_coin_type TEXT NOT NULL,
  quote_coin_symbol TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  quote_endpoint_url TEXT,
  order_endpoint_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_makers_vaults_owner_address
  ON makers_vaults (owner_address);

CREATE INDEX IF NOT EXISTS idx_makers_vaults_enabled
  ON makers_vaults (enabled);

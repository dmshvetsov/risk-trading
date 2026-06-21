CREATE TABLE IF NOT EXISTS underwrites (
  underwrite_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  taker_address TEXT NOT NULL,
  market_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  buyer_vault_id TEXT NOT NULL,
  buyer_owner_address TEXT NOT NULL,
  call_put_marker INTEGER NOT NULL CHECK (call_put_marker IN (1, 2)),
  contracts_qty_decimals TEXT NOT NULL,
  strike_price_decimals TEXT NOT NULL,
  expiry_unix_ms INTEGER NOT NULL,
  cash_premium_per_contract TEXT NOT NULL,
  quote_payload_json TEXT NOT NULL,
  quote_signature TEXT,
  order_payload_json TEXT NOT NULL,
  order_signature TEXT NOT NULL,
  order_public_key TEXT NOT NULL,
  order_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'submitted', 'confirmed', 'failed')),
  failure_internal_code TEXT,
  failure_msg TEXT,
  broadcast_queue_message_id TEXT,
  tx_digest TEXT
);

CREATE INDEX IF NOT EXISTS idx_underwrites_quote_id ON underwrites (quote_id);
CREATE INDEX IF NOT EXISTS idx_underwrites_taker_address ON underwrites (taker_address);
CREATE INDEX IF NOT EXISTS idx_underwrites_status ON underwrites (status);

CREATE TABLE IF NOT EXISTS underwrite_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  underwrite_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'submitted', 'confirmed', 'failed')),
  FOREIGN KEY (underwrite_id) REFERENCES underwrites (underwrite_id)
);

CREATE INDEX IF NOT EXISTS idx_underwrite_audit_underwrite_id
  ON underwrite_audit (underwrite_id, id);

CREATE TABLE IF NOT EXISTS option_series (
  series_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  market_id TEXT NOT NULL,
  create_tx_digest TEXT NOT NULL,
  option_type INTEGER NOT NULL CHECK (option_type IN (1, 2)),
  strike_price_decimals TEXT NOT NULL,
  strike_scale INTEGER NOT NULL,
  expiry_unix_ms INTEGER NOT NULL,
  exercise_window_end_ms INTEGER,
  exception_window_end_ms INTEGER,
  quote_coin_type TEXT NOT NULL,
  quote_decimals INTEGER NOT NULL,
  base_coin_type TEXT NOT NULL,
  base_decimals INTEGER NOT NULL,
  max_operational_fee_bps INTEGER NOT NULL,
  expiry_price_decimals TEXT,
  expiry_price_publish_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_option_series_market_expiry
  ON option_series (market_id, expiry_unix_ms);

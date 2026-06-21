export type D1Result<T> = {
  results?: T[];
  success?: boolean;
  meta?: {
    changes?: number;
  };
};

export type D1Statement = {
  bind(...values: unknown[]): {
    all<T>(): Promise<D1Result<T>>;
    first<T>(): Promise<T | null>;
    run(): Promise<D1Result<never>>;
  };
};

export type D1Database = {
  prepare(sql: string): D1Statement;
};

export type MakerVaultRow = {
  created_at: string;
  deleted_at: string | null;
  enabled: number;
  order_endpoint_url: string | null;
  owner_address: string;
  quote_coin_symbol: string;
  quote_coin_type: string;
  quote_endpoint_url: string | null;
  updated_at: string;
  vault_id: string;
};

export type UnderwriteStatus =
  | "pending"
  | "queued"
  | "submitted"
  | "confirmed"
  | "failed";

export type UnderwriteRow = {
  broadcast_queue_message_id: string | null;
  buyer_owner_address: string;
  buyer_vault_id: string;
  call_put_marker: 1 | 2;
  cash_premium_per_contract: string;
  contracts_qty_decimals: string;
  created_at: string;
  expiry_unix_ms: number;
  failure_internal_code: string | null;
  failure_msg: string | null;
  market_id: string;
  order_hash: string | null;
  order_payload_json: string;
  order_public_key: string;
  order_signature: string;
  quote_id: string;
  quote_payload_json: string;
  quote_signature: string | null;
  series_id: string;
  status: UnderwriteStatus;
  strike_price_decimals: string;
  taker_address: string;
  tx_digest: string | null;
  underwrite_id: string;
  updated_at: string;
};

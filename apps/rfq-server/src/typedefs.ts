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

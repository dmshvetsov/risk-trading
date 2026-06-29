import { supportedQuoteCoins } from "../supported-quote-coins";
import type {
  D1Database,
  MakerVaultRow,
  OptionSeriesRow,
  UnderwriteRow,
  UnderwriteStatus,
} from "../typedefs";

function nowIsoString() {
  return new Date().toISOString();
}

function getQuoteCoinSymbol(quoteCoinType: string) {
  const match = supportedQuoteCoins.find((coin) => coin.coinType === quoteCoinType);
  return match?.symbol ?? "UNKNOWN";
}

export async function readVault(db: D1Database, vaultId: string) {
  return db
    .prepare(
      `SELECT vault_id, owner_address, quote_coin_type, quote_coin_symbol,
              enabled, quote_endpoint_url, order_endpoint_url, created_at,
              updated_at, deleted_at
         FROM makers_vaults
        WHERE vault_id = ?`,
    )
    .bind(vaultId)
    .first<MakerVaultRow>();
}

export async function listVaults(db: D1Database, ownerAddress: string) {
  const result = await db
    .prepare(
      `SELECT vault_id, owner_address, quote_coin_type, quote_coin_symbol,
              enabled, quote_endpoint_url, order_endpoint_url, created_at,
              updated_at, deleted_at
         FROM makers_vaults
        WHERE owner_address = ?
        ORDER BY created_at ASC`,
    )
    .bind(ownerAddress)
    .all<MakerVaultRow>();

  return result.results ?? [];
}

export async function insertVault(
  db: D1Database,
  input: {
    ownerAddress: string;
    orderEndpointUrl?: string | null;
    quoteCoinType: string;
    quoteEndpointUrl?: string | null;
    vaultId: string;
  },
) {
  const timestamp = nowIsoString();

  await db
    .prepare(
      `INSERT INTO makers_vaults (
         vault_id,
         owner_address,
         quote_coin_type,
         quote_coin_symbol,
         enabled,
         quote_endpoint_url,
         order_endpoint_url,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.vaultId,
      input.ownerAddress,
      input.quoteCoinType,
      getQuoteCoinSymbol(input.quoteCoinType),
      1,
      input.quoteEndpointUrl ?? null,
      input.orderEndpointUrl ?? null,
      timestamp,
      timestamp,
    )
    .run();

  return readVault(db, input.vaultId);
}

export async function updateVaultEndpoints(
  db: D1Database,
  vaultId: string,
  quoteEndpointUrl: string | null,
  orderEndpointUrl: string | null,
) {
  const result = await db
    .prepare(
      `UPDATE makers_vaults
          SET quote_endpoint_url = ?,
              order_endpoint_url = ?,
              updated_at = ?
        WHERE vault_id = ?`,
    )
    .bind(quoteEndpointUrl, orderEndpointUrl, nowIsoString(), vaultId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

export async function softDeleteVault(db: D1Database, vaultId: string) {
  const timestamp = nowIsoString();
  const result = await db
    .prepare(
      `UPDATE makers_vaults
          SET enabled = 0,
              deleted_at = ?,
              updated_at = ?
        WHERE vault_id = ?`,
    )
    .bind(timestamp, timestamp, vaultId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

export type CreateUnderwriteInput = Omit<
  UnderwriteRow,
  | "broadcast_queue_message_id"
  | "created_at"
  | "failure_internal_code"
  | "failure_msg"
  | "order_hash"
  | "quote_signature"
  | "status"
  | "tx_digest"
  | "updated_at"
> &
  Partial<
    Pick<
      UnderwriteRow,
      "order_hash" | "quote_signature"
    >
  >;

export async function createUnderwrite(
  db: D1Database,
  input: CreateUnderwriteInput,
) {
  const timestamp = nowIsoString();
  await db
    .prepare(
      `INSERT INTO underwrites (
         underwrite_id, created_at, updated_at, quote_id, taker_address,
         market_id, series_id, buyer_vault_id, buyer_owner_address,
         call_put_marker, contracts_qty_decimals, strike_price_decimals,
         expiry_unix_ms, cash_premium_per_contract, quote_payload_json,
         quote_signature, order_payload_json, order_signature, order_public_key,
         order_hash, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.underwrite_id,
      timestamp,
      timestamp,
      input.quote_id,
      input.taker_address,
      input.market_id,
      input.series_id,
      input.buyer_vault_id,
      input.buyer_owner_address,
      input.call_put_marker,
      input.contracts_qty_decimals,
      input.strike_price_decimals,
      input.expiry_unix_ms,
      input.cash_premium_per_contract,
      input.quote_payload_json,
      input.quote_signature ?? null,
      input.order_payload_json,
      input.order_signature,
      input.order_public_key,
      input.order_hash ?? null,
      "pending",
    )
    .run();

  await insertUnderwriteAudit(db, input.underwrite_id, "pending", timestamp);
}

export async function updateUnderwriteStatus(
  db: D1Database,
  underwriteId: string,
  status: UnderwriteStatus,
  details: {
    broadcastQueueMessageId?: string | null;
    failureInternalCode?: string | null;
    failureMsg?: string | null;
    txDigest?: string | null;
  } = {},
) {
  const timestamp = nowIsoString();
  const result = await db
    .prepare(
      `UPDATE underwrites
          SET status = ?,
              failure_internal_code = COALESCE(?, failure_internal_code),
              failure_msg = COALESCE(?, failure_msg),
              broadcast_queue_message_id = COALESCE(?, broadcast_queue_message_id),
              tx_digest = COALESCE(?, tx_digest),
              updated_at = ?
        WHERE underwrite_id = ?`,
    )
    .bind(
      status,
      details.failureInternalCode ?? null,
      details.failureMsg ?? null,
      details.broadcastQueueMessageId ?? null,
      details.txDigest ?? null,
      timestamp,
      underwriteId,
    )
    .run();

  if ((result.meta?.changes ?? 0) === 0) return false;
  await insertUnderwriteAudit(db, underwriteId, status, timestamp);
  return true;
}

export async function readUnderwrite(db: D1Database, underwriteId: string) {
  return db
    .prepare("SELECT * FROM underwrites WHERE underwrite_id = ?")
    .bind(underwriteId)
    .first<UnderwriteRow>();
}

export async function queuePendingUnderwrite(
  db: D1Database,
  underwriteId: string,
  broadcastQueueMessageId: string,
) {
  const timestamp = nowIsoString();
  const result = await db
    .prepare(
      `UPDATE underwrites
          SET status = 'queued',
              broadcast_queue_message_id = ?,
              updated_at = ?
        WHERE underwrite_id = ? AND status = 'pending'`,
    )
    .bind(broadcastQueueMessageId, timestamp, underwriteId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) return false;
  await insertUnderwriteAudit(db, underwriteId, "queued", timestamp);
  return true;
}

export type UpsertOptionSeriesInput = Omit<
  OptionSeriesRow,
  | "created_at"
  | "exception_window_end_ms"
  | "exercise_window_end_ms"
  | "expiry_price_decimals"
  | "expiry_price_publish_time_ms"
  | "updated_at"
> &
  Partial<
    Pick<
      OptionSeriesRow,
      | "exception_window_end_ms"
      | "exercise_window_end_ms"
      | "expiry_price_decimals"
      | "expiry_price_publish_time_ms"
    >
  >;

export async function upsertOptionSeries(
  db: D1Database,
  input: UpsertOptionSeriesInput,
) {
  const timestamp = nowIsoString();
  await db
    .prepare(
      `INSERT INTO option_series (
         series_id, created_at, updated_at, market_id, create_tx_digest,
         option_type, strike_price_decimals, strike_scale, expiry_unix_ms,
         exercise_window_end_ms, exception_window_end_ms, quote_coin_type,
         quote_decimals, base_coin_type, base_decimals, max_operational_fee_bps,
         expiry_price_decimals, expiry_price_publish_time_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(series_id) DO UPDATE SET
         updated_at = excluded.updated_at,
         market_id = excluded.market_id,
         option_type = excluded.option_type,
         strike_price_decimals = excluded.strike_price_decimals,
         strike_scale = excluded.strike_scale,
         expiry_unix_ms = excluded.expiry_unix_ms,
         exercise_window_end_ms = COALESCE(excluded.exercise_window_end_ms, option_series.exercise_window_end_ms),
         exception_window_end_ms = COALESCE(excluded.exception_window_end_ms, option_series.exception_window_end_ms),
         quote_coin_type = excluded.quote_coin_type,
         quote_decimals = excluded.quote_decimals,
         base_coin_type = excluded.base_coin_type,
         base_decimals = excluded.base_decimals,
         max_operational_fee_bps = excluded.max_operational_fee_bps,
         expiry_price_decimals = COALESCE(excluded.expiry_price_decimals, option_series.expiry_price_decimals),
         expiry_price_publish_time_ms = COALESCE(excluded.expiry_price_publish_time_ms, option_series.expiry_price_publish_time_ms)`,
    )
    .bind(
      input.series_id,
      timestamp,
      timestamp,
      input.market_id,
      input.create_tx_digest,
      input.option_type,
      input.strike_price_decimals,
      input.strike_scale,
      input.expiry_unix_ms,
      input.exercise_window_end_ms ?? null,
      input.exception_window_end_ms ?? null,
      input.quote_coin_type,
      input.quote_decimals,
      input.base_coin_type,
      input.base_decimals,
      input.max_operational_fee_bps,
      input.expiry_price_decimals ?? null,
      input.expiry_price_publish_time_ms ?? null,
    )
    .run();
}

function insertUnderwriteAudit(
  db: D1Database,
  underwriteId: string,
  status: UnderwriteStatus,
  timestamp: string,
) {
  return db
    .prepare(
      `INSERT INTO underwrite_audit (created_at, underwrite_id, status)
       VALUES (?, ?, ?)`,
    )
    .bind(timestamp, underwriteId, status)
    .run();
}

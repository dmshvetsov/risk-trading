import { supportedQuoteCoins } from "../supported-quote-coins";
import type { D1Database, MakerVaultRow } from "../typedefs";

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

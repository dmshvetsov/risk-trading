import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  fromBase64,
  isValidSuiAddress,
  normalizeSuiAddress,
  toBase64,
} from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

import { createUnderwrite } from "./db/queries";
import type { D1Database } from "./typedefs";

const JULY_31_2026 = Date.UTC(2026, 6, 31);

/*
Series reference for market 0xf4f1333e5cb033fb9f29d85a0992db7ae9f6c45d7a2a0ef3a0153ef52d61ac3d
expiry: 2026-07-31 / 1785456000000
put 61000 -> 0xe41e9ae942c18ee4d002e294aab0ee04fecb5e54894905071041ea0933055a13 
put 60000 -> 0xd0be40e986bd9dee190a21128a72b125e6dd81f2ba0aef59784b0f0605e63a55
put 59000 -> 0xede4a0e3f19d6b96cb56002db3d5c2ab0468c211baadfa2e7129a5b944a3475d
put 55000 -> 0xc1573541782632c00625ae62e0c19bde4ee33268b49e9e70418a3317829a4954
put 51000 -> 0xe6e668d6db1f0f40c949735260f54f93c8d6999ff9cf15e8ec1b3824c954f9a6
call 66000 -> 0xdc2d87675a850c224e11c74ce8264425ee16b09bd6f5590717994fe6b1a535d3
call 67000 -> 0xf7793c03a14313bc507b008eafa020c2f1320f1c03ec2c8a9d71bcc6a6cb0e80
call 68000 -> 0xbad23240ddecb03f56cf9159a59a046d000f96b021cf21492679d0c5932dd998
call 71000 -> 0xef219ca26a399621780ab1391644b91ff8a29bf4ad0645fed076bf3a2b17881e
call 75000 -> 0x207f543e9e871e5619dd7c961b6f1ccbdb93fea36c73e1a28dae115ef8298f80
*/
export const TESTNET_UNDERWRITE_CONFIG = {
  baseCoinType:
    "0xced54dfe52c5b65a36379260763116faf14bbb0f1c7e0be0a4650d023b0c579e::test_btc::TEST_BTC",
  buyerOwnerAddress:
    "0xa2f04e773a5832c31bc9db1e6e4eea6f1bfbaa759be24ecbb413350a11bf7da0",
  buyerVaultId:
    "0xf8bb86b56d2a9b470703bd5ed3c1dc7ca69ab899bf1f10880c3282087b9cecaf",
    // "0xa84d8045e5da31c61c98d8ef900b78cbac2c1acde2b4b4a9145531a0c0d67882",
  marketId:
    "0xf4f1333e5cb033fb9f29d85a0992db7ae9f6c45d7a2a0ef3a0153ef52d61ac3d",
  quoteCoinType:
    "0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC",
  seriesId:
    "0xdc2d87675a850c224e11c74ce8264425ee16b09bd6f5590717994fe6b1a535d3",
  strikePrice: "66000000000",
  strikeScale: 1_000_000,
} satisfies UnderwriteChainConfig;

export type UnderwriteChainConfig = {
  baseCoinType: string;
  buyerOwnerAddress: string;
  buyerVaultId: string;
  marketId: string;
  quoteCoinType: string;
  seriesId: string;
  strikePrice: string;
  strikeScale: number;
};

export type Quote = {
  call_put_marker: 1 | 2;
  cash_premium_per_contract: string;
  cash_token_address: string;
  cash_token_decimals: number;
  collateral_token_address: string;
  collateral_token_decimals: number;
  domain: string;
  expiry_unix_ms: number;
  long_short_marker: 1 | 2;
  maker_id: string;
  offer_valid_until_total_contracts_qty_decimals: string;
  offer_valid_until_unix_ms: number;
  oracle_base_symbol: string;
  oracle_feed_id: string;
  oracle_quote_symbol: string;
  quote_id: string;
  signer: string;
  strike_price_decimals: string;
};

type PrepareEnv = {
  DB: D1Database;
  MAKER_STUB_PRIVATE_KEY?: string;
  OPERATION_FEE_BPS?: string;
  OPERATION_FEE_TREASURY?: string;
  OTP_PACKAGE_ID?: string;
};

type QuoteStore = { fetch(request: Request): Promise<Response> };

const OrderV1Bcs = bcs.struct("OrderV1", {
  domain: bcs.byteVector(),
  seller: bcs.Address,
  market_id: bcs.Address,
  series_id: bcs.Address,
  call_put_marker: bcs.u8(),
  side_market: bcs.u8(),
  strike_price: bcs.u64(),
  expiry_ms: bcs.u64(),
  contracts_quantity: bcs.u64(),
  premium_per_contract: bcs.u64(),
  good_till_ms: bcs.u64(),
  buyer_vault_id: bcs.Address,
  signer: bcs.Address,
});

const SignedOrderV1Bcs = bcs.struct("SignedOrderV1", {
  order: bcs.byteVector(),
  signature: bcs.byteVector(),
  public_key: bcs.byteVector(),
});

const QuoteV1Bcs = bcs.struct("QuoteV1", {
  domain: bcs.byteVector(),
  quote_id: bcs.string(),
  oracle_base_symbol: bcs.string(),
  oracle_quote_symbol: bcs.string(),
  oracle_feed_id: bcs.string(),
  collateral_token_address: bcs.string(),
  collateral_token_decimals: bcs.u8(),
  cash_token_address: bcs.string(),
  cash_token_decimals: bcs.u8(),
  call_put_marker: bcs.u8(),
  long_short_marker: bcs.u8(),
  strike_price_decimals: bcs.u64(),
  expiry_unix_ms: bcs.u64(),
  signer: bcs.Address,
  cash_premium_per_contract: bcs.u64(),
  offer_valid_until_total_contracts_qty_decimals: bcs.u64(),
  offer_valid_until_unix_ms: bcs.u64(),
  maker_id: bcs.string(),
});

export function serializeQuote(quote: Quote) {
  return QuoteV1Bcs.serialize({
    ...quote,
    domain: new TextEncoder().encode(quote.domain),
  }).toBytes();
}

export async function signQuote(quote: Quote, privateKey: string) {
  const keypair = Ed25519Keypair.fromSecretKey(privateKey);
  if (quote.signer !== keypair.toSuiAddress()) {
    throw new Error("quote signer does not match MAKER_STUB_PRIVATE_KEY");
  }
  return keypair.signPersonalMessage(serializeQuote(quote));
}

function response(error: string, status: number) {
  return Response.json({ error }, { status });
}

function parseUnsigned(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : null;
}

function isQuote(value: unknown): value is Quote {
  if (!value || typeof value !== "object") return false;
  const quote = value as Partial<Quote>;
  return (
    typeof quote.quote_id === "string" &&
    typeof quote.expiry_unix_ms === "number" &&
    typeof quote.offer_valid_until_unix_ms === "number" &&
    parseUnsigned(quote.strike_price_decimals) !== null &&
    parseUnsigned(quote.cash_premium_per_contract) !== null
  );
}

function readConfig(env: PrepareEnv, chain: UnderwriteChainConfig) {
  const bps = parseUnsigned(env.OPERATION_FEE_BPS);
  if (
    !env.OTP_PACKAGE_ID ||
    !env.OPERATION_FEE_TREASURY ||
    !env.MAKER_STUB_PRIVATE_KEY ||
    bps === null ||
    bps > 10_000n ||
    !isValidSuiAddress(env.OPERATION_FEE_TREASURY) ||
    !isValidSuiAddress(env.OTP_PACKAGE_ID)
  ) {
    return null;
  }

  try {
    const keypair = Ed25519Keypair.fromSecretKey(env.MAKER_STUB_PRIVATE_KEY);
    if (keypair.toSuiAddress() !== chain.buyerOwnerAddress) return null;
    return { bps, keypair };
  } catch {
    return null;
  }
}

function isSupportedQuote(quote: Quote, chain: UnderwriteChainConfig) {
  return (
    quote.domain === "otp:quote:v1" &&
    quote.call_put_marker === 1 &&
    quote.long_short_marker === 2 &&
    quote.strike_price_decimals === chain.strikePrice &&
    quote.expiry_unix_ms === JULY_31_2026 &&
    quote.cash_token_address === chain.quoteCoinType &&
    quote.collateral_token_address === chain.baseCoinType
    && quote.signer === chain.buyerOwnerAddress
  );
}

export async function prepareUnderwrite(
  request: Request,
  env: PrepareEnv,
  quoteStore: QuoteStore,
  chain: UnderwriteChainConfig = TESTNET_UNDERWRITE_CONFIG,
) {
  let body: { contractsQtyDecimals?: unknown; quote?: unknown; quoteSignature?: unknown; takerAddress?: unknown };
  try {
    body = await request.json();
  } catch {
    return response("invalid prepare request", 400);
  }

  const quantity = parseUnsigned(body.contractsQtyDecimals);
  if (
    !isQuote(body.quote) ||
    !isSupportedQuote(body.quote, chain) ||
    quantity === null ||
    quantity === 0n ||
    typeof body.quoteSignature !== "string" ||
    typeof body.takerAddress !== "string" ||
    !isValidSuiAddress(body.takerAddress)
  ) {
    return response("unsupported underwrite request", 400);
  }

  const config = readConfig(env, chain);
  if (!config) return response("underwrite configuration is unavailable", 503);

  try {
    await verifyPersonalMessageSignature(
      serializeQuote(body.quote),
      body.quoteSignature,
      { address: chain.buyerOwnerAddress },
    );
  } catch {
    return response("invalid quote signature", 400);
  }

  const premium = BigInt(body.quote.cash_premium_per_contract);
  const premiumTotal = premium * quantity;
  if (premiumTotal > 18_446_744_073_709_551_615n) {
    return response("premium calculation overflow", 400);
  }

  const consumed = await quoteStore.fetch(new Request("https://quote-store.internal/validate", {
    body: JSON.stringify({
      contractsQtyDecimals: quantity.toString(),
      quote: body.quote,
      quoteId: body.quote.quote_id,
      quoteSignature: body.quoteSignature,
    }),
    method: "POST",
  }));
  if (!consumed.ok) return response("quote is expired or lacks capacity", 409);
  const quoteState = await consumed.json() as { quote?: unknown; remainingContractsQtyDecimals?: unknown };
  if (
    !isQuote(quoteState.quote) ||
    JSON.stringify(quoteState.quote) !== JSON.stringify(body.quote) ||
    quoteState.quote.offer_valid_until_unix_ms <= Date.now()
  ) {
    return response("quote could not be revalidated", 409);
  }

  const operationalFee = premiumTotal * config.bps / 10_000n;
  const takerAddress = normalizeSuiAddress(body.takerAddress);
  const order = {
    domain: new TextEncoder().encode("otp:order:v1"),
    seller: takerAddress,
    market_id: chain.marketId,
    series_id: chain.seriesId,
    call_put_marker: 1,
    side_market: 1,
    strike_price: chain.strikePrice,
    expiry_ms: body.quote.expiry_unix_ms,
    contracts_quantity: quantity.toString(),
    premium_per_contract: body.quote.cash_premium_per_contract,
    good_till_ms: body.quote.offer_valid_until_unix_ms,
    buyer_vault_id: chain.buyerVaultId,
    signer: chain.buyerOwnerAddress,
  };
  const orderBytes = OrderV1Bcs.serialize(order).toBytes();
  const signed = await config.keypair.signPersonalMessage(orderBytes);
  const serializedSignature = fromBase64(signed.signature);
  const publicKey = config.keypair.getPublicKey().toRawBytes();
  const signedOrderBytes = SignedOrderV1Bcs.serialize({
    order: orderBytes,
    public_key: publicKey,
    signature: serializedSignature,
  }).toBytes();
  const underwriteId = crypto.randomUUID();

  await createUnderwrite(env.DB, {
    buyer_owner_address: chain.buyerOwnerAddress,
    buyer_vault_id: chain.buyerVaultId,
    call_put_marker: 1,
    cash_premium_per_contract: body.quote.cash_premium_per_contract,
    contracts_qty_decimals: quantity.toString(),
    expiry_unix_ms: body.quote.expiry_unix_ms,
    market_id: chain.marketId,
    order_payload_json: JSON.stringify({ ...order, domain: "otp:order:v1" }),
    order_public_key: toBase64(publicKey),
    order_signature: signed.signature,
    quote_id: body.quote.quote_id,
    quote_payload_json: JSON.stringify(body.quote),
    quote_signature: body.quoteSignature,
    series_id: chain.seriesId,
    strike_price_decimals: body.quote.strike_price_decimals,
    taker_address: takerAddress,
    underwrite_id: underwriteId,
  });

  return Response.json({
    baseCoinType: chain.baseCoinType,
    buyerVaultId: chain.buyerVaultId,
    feeRecipient: env.OPERATION_FEE_TREASURY,
    marketId: chain.marketId,
    operationalFee: operationalFee.toString(),
    orderBytes: toBase64(orderBytes),
    orderPublicKey: toBase64(publicKey),
    orderSignature: signed.signature,
    packageId: env.OTP_PACKAGE_ID,
    quoteCoinType: chain.quoteCoinType,
    seriesId: chain.seriesId,
    signedOrderBytes: toBase64(signedOrderBytes),
    status: "pending",
    target: `${env.OTP_PACKAGE_ID}::underwriting::underwrite_call`,
    underwriteId,
  }, { status: 201 });
}

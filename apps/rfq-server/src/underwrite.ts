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
import { prepareUnderwriteBodySchema, quoteSchema } from "./validation";

const JULY_31_2026 = Date.UTC(2026, 6, 31);
const BTC_DECIMALS = 8n;
const USDC_DECIMALS = 6;

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
const TESTNET_UNDERWRITE_BASE = {
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
  strikeScale: 1_000_000,
};

export const TESTNET_UNDERWRITE_CONFIGS = [
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 1 as const,
    seriesId:
      "0xdc2d87675a850c224e11c74ce8264425ee16b09bd6f5590717994fe6b1a535d3",
    strikePrice: "66000000000",
    targetFunction: "underwrite_call" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 1 as const,
    seriesId:
      "0xf7793c03a14313bc507b008eafa020c2f1320f1c03ec2c8a9d71bcc6a6cb0e80",
    strikePrice: "67000000000",
    targetFunction: "underwrite_call" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 1 as const,
    seriesId:
      "0xbad23240ddecb03f56cf9159a59a046d000f96b021cf21492679d0c5932dd998",
    strikePrice: "68000000000",
    targetFunction: "underwrite_call" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 1 as const,
    seriesId:
      "0xef219ca26a399621780ab1391644b91ff8a29bf4ad0645fed076bf3a2b17881e",
    strikePrice: "71000000000",
    targetFunction: "underwrite_call" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 1 as const,
    seriesId:
      "0x207f543e9e871e5619dd7c961b6f1ccbdb93fea36c73e1a28dae115ef8298f80",
    strikePrice: "75000000000",
    targetFunction: "underwrite_call" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 2 as const,
    seriesId:
      "0xe41e9ae942c18ee4d002e294aab0ee04fecb5e54894905071041ea0933055a13",
    strikePrice: "61000000000",
    targetFunction: "underwrite_put" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 2 as const,
    seriesId:
      "0xd0be40e986bd9dee190a21128a72b125e6dd81f2ba0aef59784b0f0605e63a55",
    strikePrice: "60000000000",
    targetFunction: "underwrite_put" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 2 as const,
    seriesId:
      "0xede4a0e3f19d6b96cb56002db3d5c2ab0468c211baadfa2e7129a5b944a3475d",
    strikePrice: "59000000000",
    targetFunction: "underwrite_put" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 2 as const,
    seriesId:
      "0xc1573541782632c00625ae62e0c19bde4ee33268b49e9e70418a3317829a4954",
    strikePrice: "55000000000",
    targetFunction: "underwrite_put" as const,
  },
  {
    ...TESTNET_UNDERWRITE_BASE,
    callPutMarker: 2 as const,
    seriesId:
      "0xe6e668d6db1f0f40c949735260f54f93c8d6999ff9cf15e8ec1b3824c954f9a6",
    strikePrice: "51000000000",
    targetFunction: "underwrite_put" as const,
  },
] satisfies UnderwriteChainConfig[];

export type UnderwriteChainConfig = {
  baseCoinType: string;
  buyerOwnerAddress: string;
  buyerVaultId: string;
  callPutMarker: 1 | 2;
  marketId: string;
  quoteCoinType: string;
  seriesId: string;
  strikePrice: string;
  strikeScale: number;
  targetFunction: "underwrite_call" | "underwrite_put";
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
  taker_address: bcs.Address,
  market_id: bcs.Address,
  call_put_marker: bcs.u8(),
  side_marker: bcs.u8(),
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
  const expectedCollateral = chain.callPutMarker === 1
    ? chain.baseCoinType
    : chain.quoteCoinType;
  const expectedCollateralDecimals = chain.callPutMarker === 1 ? Number(BTC_DECIMALS) : USDC_DECIMALS;
  return (
    quote.domain === "otp:quote:v1" &&
    quote.call_put_marker === chain.callPutMarker &&
    quote.long_short_marker === 2 &&
    quote.strike_price_decimals === chain.strikePrice &&
    quote.expiry_unix_ms === JULY_31_2026 &&
    quote.cash_token_address === chain.quoteCoinType &&
    quote.cash_token_decimals === USDC_DECIMALS &&
    quote.collateral_token_address === expectedCollateral &&
    quote.collateral_token_decimals === expectedCollateralDecimals &&
    quote.signer === chain.buyerOwnerAddress
  );
}

function resolveSupportedChainConfig(
  quote: Quote,
  chain: UnderwriteChainConfig | UnderwriteChainConfig[],
) {
  const chains = Array.isArray(chain) ? chain : [chain];
  return chains.find((candidate) => isSupportedQuote(quote, candidate)) ?? null;
}

function collateralAmountForQuantity(
  quantity: bigint,
  chain: UnderwriteChainConfig,
) {
  if (chain.callPutMarker === 1) {
    return quantity.toString();
  }

  const strike = BigInt(chain.strikePrice);
  const quoteScale = 10n ** BigInt(USDC_DECIMALS);
  const denominator = (10n ** BTC_DECIMALS) * BigInt(chain.strikeScale);
  return (quantity * strike * quoteScale / denominator).toString();
}

export async function prepareUnderwrite(
  request: Request,
  env: PrepareEnv,
  quoteStore: QuoteStore,
  chain: UnderwriteChainConfig | UnderwriteChainConfig[] = TESTNET_UNDERWRITE_CONFIGS,
) {
  let body: { contractsQtyDecimals?: unknown; quote?: unknown; quoteSignature?: unknown; takerAddress?: unknown };
  try {
    body = await request.json();
  } catch {
    return response("invalid prepare request", 400);
  }

  const parsedBody = prepareUnderwriteBodySchema.safeParse(body);
  const supportedChain = parsedBody.success
    ? resolveSupportedChainConfig(parsedBody.data.quote, chain)
    : null;
  if (
    !parsedBody.success ||
    !supportedChain
  ) {
    return response("unsupported underwrite request", 400);
  }
  const { contractsQtyDecimals: quantity } = parsedBody.data;

  const config = readConfig(env, supportedChain);
  if (!config) return response("underwrite configuration is unavailable", 503);

  try {
    await verifyPersonalMessageSignature(
      serializeQuote(parsedBody.data.quote),
      parsedBody.data.quoteSignature,
      { address: supportedChain.buyerOwnerAddress },
    );
  } catch {
    return response("invalid quote signature", 400);
  }

  const premium = BigInt(parsedBody.data.quote.cash_premium_per_contract);
  const premiumTotal = premium * quantity;
  if (premiumTotal > 18_446_744_073_709_551_615n) {
    return response("premium calculation overflow", 400);
  }

  const consumed = await quoteStore.fetch(new Request("https://quote-store.internal/validate", {
    body: JSON.stringify({
      contractsQtyDecimals: quantity.toString(),
      quote: parsedBody.data.quote,
      quoteId: parsedBody.data.quote.quote_id,
      quoteSignature: parsedBody.data.quoteSignature,
    }),
    method: "POST",
  }));
  if (!consumed.ok) return response("quote is expired or lacks capacity", 409);
  const quoteState = await consumed.json() as { quote?: unknown; remainingContractsQtyDecimals?: unknown };
  const parsedStoredQuote = quoteSchema.safeParse(quoteState.quote);
  if (
    !parsedStoredQuote.success ||
    JSON.stringify(parsedStoredQuote.data) !== JSON.stringify(parsedBody.data.quote) ||
    parsedStoredQuote.data.offer_valid_until_unix_ms <= Date.now()
  ) {
    return response("quote could not be revalidated", 409);
  }

  const operationalFee = premiumTotal * config.bps / 10_000n;
  const collateralAmount = collateralAmountForQuantity(quantity, supportedChain);
  const takerAddress = normalizeSuiAddress(parsedBody.data.takerAddress);
  const order = {
    domain: new TextEncoder().encode("otp:order:v1"),
    taker_address: takerAddress,
    market_id: supportedChain.marketId,
    call_put_marker: supportedChain.callPutMarker,
    side_marker: 1,
    strike_price: supportedChain.strikePrice,
    expiry_ms: parsedBody.data.quote.expiry_unix_ms,
    contracts_quantity: quantity.toString(),
    premium_per_contract: parsedBody.data.quote.cash_premium_per_contract,
    good_till_ms: parsedBody.data.quote.offer_valid_until_unix_ms,
    buyer_vault_id: supportedChain.buyerVaultId,
    signer: supportedChain.buyerOwnerAddress,
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
    buyer_owner_address: supportedChain.buyerOwnerAddress,
    buyer_vault_id: supportedChain.buyerVaultId,
    call_put_marker: supportedChain.callPutMarker,
    cash_premium_per_contract: parsedBody.data.quote.cash_premium_per_contract,
    contracts_qty_decimals: quantity.toString(),
    expiry_unix_ms: parsedBody.data.quote.expiry_unix_ms,
    market_id: supportedChain.marketId,
    order_payload_json: JSON.stringify({ ...order, domain: "otp:order:v1" }),
    order_public_key: toBase64(publicKey),
    order_signature: signed.signature,
    quote_id: parsedBody.data.quote.quote_id,
    quote_payload_json: JSON.stringify(parsedBody.data.quote),
    quote_signature: parsedBody.data.quoteSignature,
    series_id: supportedChain.seriesId,
    strike_price_decimals: parsedBody.data.quote.strike_price_decimals,
    taker_address: takerAddress,
    underwrite_id: underwriteId,
  });

  return Response.json({
    baseCoinType: supportedChain.baseCoinType,
    buyerVaultId: supportedChain.buyerVaultId,
    collateralAmount,
    feeRecipient: env.OPERATION_FEE_TREASURY,
    marketId: supportedChain.marketId,
    operationalFee: operationalFee.toString(),
    orderBytes: toBase64(orderBytes),
    orderPublicKey: toBase64(publicKey),
    orderSignature: signed.signature,
    packageId: env.OTP_PACKAGE_ID,
    quoteCoinType: supportedChain.quoteCoinType,
    seriesId: supportedChain.seriesId,
    signedOrderBytes: toBase64(signedOrderBytes),
    status: "pending",
    target: `${env.OTP_PACKAGE_ID}::underwriting::${supportedChain.targetFunction}`,
    underwriteId,
  }, { status: 201 });
}

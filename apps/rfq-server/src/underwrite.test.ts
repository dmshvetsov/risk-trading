import assert from "node:assert/strict";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { describe, it } from "vitest";

import {
  prepareUnderwrite,
  serializeQuote,
  type UnderwriteChainConfig,
} from "./underwrite";

const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7));
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
const expiry = Date.UTC(2026, 6, 31);
const quote = {
  call_put_marker: 1 as const,
  cash_premium_per_contract: "1000001",
  cash_token_address: "0x2::test_usdc::TEST_USDC",
  cash_token_decimals: 6,
  collateral_token_address: "0x3::test_btc::TEST_BTC",
  collateral_token_decimals: 8,
  domain: "otp:quote:v1" as const,
  expiry_unix_ms: expiry,
  long_short_marker: 2 as const,
  maker_id: "server-stub-provider",
  offer_valid_until_total_contracts_qty_decimals: "1000000",
  offer_valid_until_unix_ms: expiry - 1,
  oracle_base_symbol: "BTC" as const,
  oracle_feed_id: "feed",
  oracle_quote_symbol: "USDC" as const,
  quote_id: "quote-1",
  signer: keypair.toSuiAddress(),
  strike_price_decimals: "6600000000000",
};
const quoteSignature = (await keypair.signPersonalMessage(serializeQuote(quote))).signature;
const putQuote = {
  ...quote,
  call_put_marker: 2 as const,
  collateral_token_address: quote.cash_token_address,
  collateral_token_decimals: 6,
  strike_price_decimals: "6100000000000",
};
const putQuoteSignature = (await keypair.signPersonalMessage(serializeQuote(putQuote))).signature;

const chain: UnderwriteChainConfig = {
  baseCoinType: quote.collateral_token_address,
  buyerOwnerAddress: keypair.toSuiAddress(),
  buyerVaultId: `0x${"44".repeat(32)}`,
  callPutMarker: 1,
  marketId: `0x${"22".repeat(32)}`,
  quoteCoinType: quote.cash_token_address,
  seriesId: `0x${"33".repeat(32)}`,
  strikePrice: quote.strike_price_decimals,
  strikeScale: 100_000_000,
  targetFunction: "underwrite_call",
};

const putChain: UnderwriteChainConfig = {
  ...chain,
  callPutMarker: 2,
  seriesId: `0x${"99".repeat(32)}`,
  strikePrice: putQuote.strike_price_decimals,
  targetFunction: "underwrite_put",
};

function env(overrides: Record<string, unknown> = {}) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  return {
    writes,
    value: {
      DB: {
        prepare(sql: string) {
          return { bind: (...values: unknown[]) => ({
            run: async () => { writes.push({ sql, values }); return { meta: { changes: 1 } }; },
          }) };
        },
      },
      MAKER_STUB_PRIVATE_KEY: keypair.getSecretKey(),
      OPERATION_FEE_BPS: "250",
      OPERATION_FEE_TREASURY: `0x${"55".repeat(32)}`,
      OTP_PACKAGE_ID: `0x${"11".repeat(32)}`,
      ...overrides,
    },
  };
}

function store(state = { quote, quoteSignature, remainingContractsQtyDecimals: "1000000" }) {
  return {
    fetch: async (request: Request) => {
      assert.equal(request.method, "POST");
      const payload = await request.json() as { contractsQtyDecimals: string; quoteSignature: string };
      assert.equal(payload.quoteSignature, state.quoteSignature);
      if (
        state.quote.offer_valid_until_unix_ms <= Date.now() ||
        BigInt(payload.contractsQtyDecimals) > BigInt(state.remainingContractsQtyDecimals)
      ) {
        return Response.json({ error: "quote unavailable" }, { status: 409 });
      }
      return Response.json({
        ...state,
        remainingContractsQtyDecimals:
          (BigInt(state.remainingContractsQtyDecimals) - BigInt(payload.contractsQtyDecimals)).toString(),
      });
    },
  };
}

function request(body: Record<string, unknown> = {}) {
  return new Request("https://rfq.test/api/underwrites/prepare", {
    body: JSON.stringify({
      contractsQtyDecimals: "500000",
      quote,
      quoteSignature,
      takerAddress: `0x${"66".repeat(32)}`,
      ...body,
    }),
    method: "POST",
  });
}

function putRequest(body: Record<string, unknown> = {}) {
  return new Request("https://rfq.test/api/underwrites/prepare", {
    body: JSON.stringify({
      contractsQtyDecimals: "500000",
      quote: putQuote,
      quoteSignature: putQuoteSignature,
      takerAddress: `0x${"66".repeat(32)}`,
      ...body,
    }),
    method: "POST",
  });
}

describe("prepareUnderwrite", () => {
  it("consumes capacity, signs canonical OrderV1, persists pending, and returns PTB inputs", async () => {
    const testEnv = env();
    const response = await prepareUnderwrite(request(), testEnv.value, store(), chain);
    assert.equal(response.status, 201);
    const result = await response.json() as Record<string, unknown>;
    assert.equal(result.status, "pending");
    assert.equal(result.operationalFee, "12500012500");
    assert.equal(result.marketId, chain.marketId);
    assert.equal(result.seriesId, chain.seriesId);
    assert.equal(result.buyerVaultId, chain.buyerVaultId);
    assert.equal(result.quoteCoinType, chain.quoteCoinType);
    assert.equal(result.baseCoinType, chain.baseCoinType);
    assert.equal(result.collateralAmount, "500000");
    assert.equal(result.feeRecipient, testEnv.value.OPERATION_FEE_TREASURY);
    assert.equal(result.packageId, testEnv.value.OTP_PACKAGE_ID);
    assert.equal(result.target, `${testEnv.value.OTP_PACKAGE_ID}::underwriting::underwrite_call`);
    assert.equal(typeof result.signedOrderBytes, "string");
    assert.equal(typeof result.orderSignature, "string");
    const order = OrderV1Bcs.parse(fromBase64(String(result.orderBytes)));
    assert.deepEqual(Array.from(order.domain), Array.from(new TextEncoder().encode("otp:order:v1")));
    assert.equal(order.taker_address, `0x${"66".repeat(32)}`);
    assert.equal(order.market_id, chain.marketId);
    assert.equal(order.call_put_marker, 1);
    assert.equal(order.side_marker, 1);
    assert.equal(order.strike_price, quote.strike_price_decimals);
    assert.equal(order.expiry_ms, String(expiry));
    assert.equal(order.contracts_quantity, "500000");
    assert.equal(order.premium_per_contract, quote.cash_premium_per_contract);
    assert.equal(order.good_till_ms, String(expiry - 1));
    assert.equal(order.buyer_vault_id, chain.buyerVaultId);
    assert.equal(order.signer, chain.buyerOwnerAddress);
    assert.equal("series_id" in order, false);
    const verifiedKey = await verifyPersonalMessageSignature(
      fromBase64(String(result.orderBytes)),
      String(result.orderSignature),
      { address: chain.buyerOwnerAddress },
    );
    assert.equal(verifiedKey.toSuiAddress(), chain.buyerOwnerAddress);
    assert.equal(testEnv.writes.length, 2);
    assert.match(testEnv.writes[0].sql, /INSERT INTO underwrites/);
    assert.match(testEnv.writes[1].sql, /INSERT INTO underwrite_audit/);
  });

  it("prepares approved cash-secured puts with the put series and exact USDC collateral", async () => {
    const testEnv = env();
    const response = await prepareUnderwrite(putRequest(), testEnv.value, store({
      quote: putQuote,
      quoteSignature: putQuoteSignature,
      remainingContractsQtyDecimals: "500000",
    }), putChain);
    assert.equal(response.status, 201);
    const result = await response.json() as Record<string, unknown>;
    assert.equal(result.seriesId, putChain.seriesId);
    assert.equal(result.baseCoinType, putChain.baseCoinType);
    assert.equal(result.collateralAmount, "305000000");
    assert.equal(result.target, `${testEnv.value.OTP_PACKAGE_ID}::underwriting::underwrite_put`);
  });

  it("rejects unsupported, expired, and over-capacity quotes", async () => {
    const unsupported = await prepareUnderwrite(
      request({ quote: { ...quote, strike_price_decimals: "6700000000000" } }),
      env().value,
      store(),
      chain,
    );
    assert.equal(unsupported.status, 400);

    const expired = await prepareUnderwrite(request(), env().value, store({
      quote: { ...quote, offer_valid_until_unix_ms: 1 },
      quoteSignature,
      remainingContractsQtyDecimals: "1000000",
    }), chain);
    assert.equal(expired.status, 409);

    const exhausted = await prepareUnderwrite(request(), env().value, store({
      quote,
      quoteSignature,
      remainingContractsQtyDecimals: "1",
    }), chain);
    assert.equal(exhausted.status, 409);
  });

  it("rejects malformed prepare payloads", async () => {
    const invalidQuantity = await prepareUnderwrite(
      request({ contractsQtyDecimals: 500000 }),
      env().value,
      store(),
      chain,
    );
    assert.equal(invalidQuantity.status, 400);

    const invalidAddress = await prepareUnderwrite(
      request({ takerAddress: "not-an-address" }),
      env().value,
      store(),
      chain,
    );
    assert.equal(invalidAddress.status, 400);
  });

  it("rejects missing config, invalid fee BPS, and a mismatched maker key", async () => {
    assert.equal((await prepareUnderwrite(request(), env({ OTP_PACKAGE_ID: undefined }).value, store(), chain)).status, 503);
    assert.equal((await prepareUnderwrite(request(), env({ OPERATION_FEE_BPS: "10001" }).value, store(), chain)).status, 503);
    const wrongKey = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8));
    assert.equal((await prepareUnderwrite(request(), env({ MAKER_STUB_PRIVATE_KEY: wrongKey.getSecretKey() }).value, store(), chain)).status, 503);
    assert.equal((await prepareUnderwrite(request({ quoteSignature: "invalid" }), env().value, store(), chain)).status, 400);
  });
});

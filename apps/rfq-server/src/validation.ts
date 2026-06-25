import { isValidSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";

import type { QuoteRequest } from "./stub-quote-provider";
import type { Quote } from "./underwrite";

export const BTC_USD_FEED_ID =
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const QUANTITY_STEP = 500_000n;
export const MVP_STRIKE_SCALE = 1_000_000n;
const STRIKE_STEP_DECIMALS = 1_000n * MVP_STRIKE_SCALE;

const unsignedDecimalString = z.string().regex(/^\d+$/);

const baseQuoteSchema = z.object({
  call_put_marker: z.union([z.literal(1), z.literal(2)]),
  cash_token_address: z.string(),
  cash_token_decimals: z.number(),
  collateral_token_address: z.string(),
  collateral_token_decimals: z.number(),
  contracts_qty_decimals: unsignedDecimalString,
  expiry_unix_ms: z.number(),
  long_short_marker: z.literal(2),
  oracle_base_symbol: z.literal("BTC"),
  oracle_feed_id: z.literal(BTC_USD_FEED_ID),
  oracle_quote_symbol: z.literal("USDC"),
  strike_price_decimals: unsignedDecimalString,
});

function lastFridayOfMonth(year: number, month: number) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  const day = date.getUTCDay();
  const daysSinceFriday = (day + 2) % 7;
  return Date.UTC(year, month, date.getUTCDate() - daysSinceFriday, 8);
}

export function isTradableExpiry(expiryUnixMs: number, nowUnixMs = Date.now()) {
  const expiry = new Date(expiryUnixMs);
  const now = new Date(nowUnixMs);
  const nextMonth = now.getUTCMonth() + 1;
  const lastAllowed = lastFridayOfMonth(now.getUTCFullYear(), nextMonth);

  return (
    Number.isInteger(expiryUnixMs) &&
    expiryUnixMs > nowUnixMs &&
    expiry.getUTCHours() === 8 &&
    expiry.getUTCMinutes() === 0 &&
    expiry.getUTCSeconds() === 0 &&
    expiry.getUTCMilliseconds() === 0 &&
    expiry.getUTCDay() === 5 &&
    expiryUnixMs <= lastAllowed
  );
}

export function isTradableStrike(strikePriceDecimals: string) {
  const strike = BigInt(strikePriceDecimals);
  return strike > 0n && strike % STRIKE_STEP_DECIMALS === 0n;
}

export function isBtcUsdcOracleMarket(input: {
  oracle_base_symbol: string;
  oracle_feed_id: string;
  oracle_quote_symbol: string;
}) {
  return (
    input.oracle_base_symbol === "BTC" &&
    input.oracle_quote_symbol === "USDC" &&
    input.oracle_feed_id === BTC_USD_FEED_ID
  );
}

export function createQuoteRequestSchema(
  supportedQuoteCoinTypes: readonly string[],
  coveredCallMarkets: ReadonlyMap<string, string>,
) {
  return baseQuoteSchema.superRefine((request, ctx) => {
    const quantity = BigInt(request.contracts_qty_decimals);
    const strike = BigInt(request.strike_price_decimals);
    const quantityIsValid =
      quantity >= QUANTITY_STEP && quantity % QUANTITY_STEP === 0n;
    const isCoveredCall =
      request.call_put_marker === 1 &&
      request.collateral_token_address ===
        coveredCallMarkets.get(request.cash_token_address) &&
      request.collateral_token_decimals === 8 &&
      quantityIsValid;
    const isCashSecuredPut =
      request.call_put_marker === 2 &&
      request.collateral_token_address === request.cash_token_address &&
      request.collateral_token_decimals === 6 &&
      quantityIsValid;

    if (!(isCoveredCall || isCashSecuredPut)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid market" });
    }
    if (!supportedQuoteCoinTypes.includes(request.cash_token_address)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unsupported quote coin",
      });
    }
    if (request.cash_token_decimals !== 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid cash token decimals",
      });
    }
    if (strike <= 0n || !isTradableStrike(request.strike_price_decimals)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid strike" });
    }
    if (!isTradableExpiry(request.expiry_unix_ms)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expired quote" });
    }
  });
}

export const quoteRequestPayloadSchema = z.object({
  request: z.unknown(),
});

export const quoteSchema = z.object({
  call_put_marker: z.union([z.literal(1), z.literal(2)]),
  cash_premium_per_contract: unsignedDecimalString,
  cash_token_address: z.string(),
  cash_token_decimals: z.number(),
  collateral_token_address: z.string(),
  collateral_token_decimals: z.number(),
  domain: z.string(),
  expiry_unix_ms: z.number(),
  long_short_marker: z.union([z.literal(1), z.literal(2)]),
  maker_id: z.string(),
  offer_valid_until_total_contracts_qty_decimals: unsignedDecimalString,
  offer_valid_until_unix_ms: z.number(),
  oracle_base_symbol: z.string(),
  oracle_feed_id: z.string(),
  oracle_quote_symbol: z.string(),
  quote_id: z.string(),
  signer: z.string(),
  strike_price_decimals: unsignedDecimalString,
}) satisfies z.ZodType<Quote>;

export const prepareUnderwriteBodySchema = z.object({
  contractsQtyDecimals: unsignedDecimalString.transform((value) => BigInt(value))
    .refine((value) => value > 0n, { message: "quantity must be positive" }),
  quote: quoteSchema,
  quoteSignature: z.string(),
  takerAddress: z.string().refine((value) => isValidSuiAddress(value), {
    message: "invalid taker address",
  }),
});

export type ParsedQuoteRequest = QuoteRequest;
export type ParsedPrepareUnderwriteBody = z.infer<
  typeof prepareUnderwriteBodySchema
>;

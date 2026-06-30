import { queryOptions } from "@tanstack/react-query";

import type { SeriesGridMarket } from "@/lib/series-grid";

export type DisplayQuote = {
  cashPremiumPerContract: string;
  cashTokenDecimals: number;
  contractsQtyDecimals: string;
  collateralTokenDecimals: number;
  expiryUnixMs: number;
  offerValidUntilUnixMs: number;
  strikePriceDecimals: string;
  quote: QuotePayload;
  quoteSignature: string;
};

export type QuotePayload = {
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

export type QuoteInputs = {
  expiryUnixMs: number;
  size: number;
  strikePriceDecimals: string;
};
export type QuoteStrategy = "covered-call" | "cash-secured-put";
export type QuoteMarketTerms = Pick<
  SeriesGridMarket,
  | "baseCoinType"
  | "baseDecimals"
  | "oracleBaseSymbol"
  | "oracleFeedId"
  | "oracleQuoteSymbol"
  | "quoteDecimals"
  | "quoteCoinType"
>;

export function quoteTerms(strategy: QuoteStrategy, size: number, strike: number) {
  if (strategy === "cash-secured-put") {
    return {
      collateralAmount: size * strike,
      collateralSymbol: "USDC" as const,
      downsideAmount: size,
      downsideSymbol: "WBTC" as const,
      upsideAmount: size * strike,
      upsideSymbol: "USDC" as const,
    };
  }

  return {
    collateralAmount: size,
    collateralSymbol: "WBTC" as const,
    downsideAmount: size,
    downsideSymbol: "WBTC" as const,
    upsideAmount: size * strike,
    upsideSymbol: "USDC" as const,
  };
}

export function decimalAmount(value: string, decimals: number) {
  return Number(value) / 10 ** decimals;
}

export function secondsUntilExpiry(expiryUnixMs: number, nowUnixMs: number) {
  return Math.max(0, Math.ceil((expiryUnixMs - nowUnixMs) / 1_000));
}

export function quantityToContractsQtyDecimals(size: number, baseDecimals = 8) {
  return String(Math.round(size * 10 ** baseDecimals));
}

export function strikeToPriceDecimals(strike: number, strikeScale: number) {
  return String(Math.round(strike * strikeScale));
}

export function quotePremiumTotal(
  cashPremiumPerContract: string,
  contractsQtyDecimals: string,
  contractDecimals: number,
  cashTokenDecimals: number,
) {
  return decimalAmount(
    String(
      BigInt(cashPremiumPerContract) * BigInt(contractsQtyDecimals) /
        10n ** BigInt(contractDecimals),
    ),
    cashTokenDecimals,
  );
}

export async function requestQuote(
  rfqApiUrl: string,
  market: QuoteMarketTerms,
  strategy: QuoteStrategy,
  inputs: QuoteInputs,
  request: typeof fetch = fetch,
) {
  const isPut = strategy === "cash-secured-put";
  const response = await request(`${rfqApiUrl}/api/quotes`, {
    body: JSON.stringify({
      request: {
        oracle_base_symbol: market.oracleBaseSymbol,
        oracle_quote_symbol: market.oracleQuoteSymbol,
        oracle_feed_id: market.oracleFeedId,
        collateral_token_address: isPut ? market.quoteCoinType : market.baseCoinType,
        collateral_token_decimals: isPut ? market.quoteDecimals : market.baseDecimals,
        cash_token_address: market.quoteCoinType,
        cash_token_decimals: market.quoteDecimals,
        call_put_marker: isPut ? 2 : 1,
        long_short_marker: 2,
        strike_price_decimals: inputs.strikePriceDecimals,
        expiry_unix_ms: inputs.expiryUnixMs,
        contracts_qty_decimals: quantityToContractsQtyDecimals(
          inputs.size,
          market.baseDecimals,
        ),
      },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Quote request failed");
  }

  const payload = (await response.json()) as {
    quote: QuotePayload;
    quote_signature: string;
  };

  return {
    cashPremiumPerContract: payload.quote.cash_premium_per_contract,
    cashTokenDecimals: payload.quote.cash_token_decimals,
    contractsQtyDecimals: quantityToContractsQtyDecimals(
      inputs.size,
      market.baseDecimals,
    ),
    collateralTokenDecimals: payload.quote.collateral_token_decimals,
    expiryUnixMs: payload.quote.expiry_unix_ms,
    offerValidUntilUnixMs: payload.quote.offer_valid_until_unix_ms,
    strikePriceDecimals: payload.quote.strike_price_decimals,
    quote: payload.quote,
    quoteSignature: payload.quote_signature,
  } satisfies DisplayQuote;
}

export function quoteQueryOptions(
  rfqApiUrl: string,
  market: QuoteMarketTerms,
  strategy: QuoteStrategy,
  inputs: QuoteInputs,
  request: typeof fetch = fetch,
) {
  return queryOptions({
    queryKey: [
      "quote",
      rfqApiUrl,
      market.baseCoinType,
      market.baseDecimals,
      market.quoteCoinType,
      market.quoteDecimals,
      market.oracleBaseSymbol,
      market.oracleQuoteSymbol,
      market.oracleFeedId,
      strategy,
      inputs.expiryUnixMs,
      inputs.size,
      inputs.strikePriceDecimals,
    ] as const,
    queryFn: () => requestQuote(
      rfqApiUrl,
      market,
      strategy,
      inputs,
      request,
    ),
    retry: false,
  });
}

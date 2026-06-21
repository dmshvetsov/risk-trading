import { queryOptions } from "@tanstack/react-query";

export type DisplayQuote = {
  cashPremiumPerContract: string;
  cashTokenDecimals: number;
  contractsQtyDecimals: string;
  collateralTokenDecimals: number;
  expiryUnixMs: number;
  offerValidUntilUnixMs: number;
  strikePriceDecimals: string;
};

type QuoteInputs = { expiryUnixMs: number; size: number; strike: number };
export type QuoteStrategy = "covered-call" | "cash-secured-put";

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

export function quantityToContractsQtyDecimals(size: number) {
  return String(Math.round(size * 10 ** 8));
}

export async function requestQuote(
  rfqApiUrl: string,
  cashTokenAddress: string,
  strategy: QuoteStrategy,
  inputs: QuoteInputs,
  request: typeof fetch = fetch,
) {
  const isPut = strategy === "cash-secured-put";
  const response = await request(`${rfqApiUrl}/api/quotes`, {
    body: JSON.stringify({
      request: {
        oracle_base_symbol: "BTC",
        oracle_quote_symbol: "USDC",
        oracle_feed_id:
          "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        collateral_token_address: isPut
          ? cashTokenAddress
          : "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC",
        collateral_token_decimals: isPut ? 6 : 8,
        cash_token_address: cashTokenAddress,
        cash_token_decimals: 6,
        call_put_marker: isPut ? 2 : 1,
        long_short_marker: 2,
        strike_price_decimals: String(Math.round(inputs.strike * 1_000_000)),
        expiry_unix_ms: inputs.expiryUnixMs,
        contracts_qty_decimals: quantityToContractsQtyDecimals(inputs.size),
      },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Quote request failed");
  }

  const payload = (await response.json()) as {
    quote: {
      cash_premium_per_contract: string;
      cash_token_decimals: number;
      collateral_token_decimals: number;
      expiry_unix_ms: number;
      offer_valid_until_total_contracts_qty_decimals: string;
      offer_valid_until_unix_ms: number;
      strike_price_decimals: string;
    };
  };

  return {
    cashPremiumPerContract: payload.quote.cash_premium_per_contract,
    cashTokenDecimals: payload.quote.cash_token_decimals,
    contractsQtyDecimals:
      payload.quote.offer_valid_until_total_contracts_qty_decimals,
    collateralTokenDecimals: payload.quote.collateral_token_decimals,
    expiryUnixMs: payload.quote.expiry_unix_ms,
    offerValidUntilUnixMs: payload.quote.offer_valid_until_unix_ms,
    strikePriceDecimals: payload.quote.strike_price_decimals,
  } satisfies DisplayQuote;
}

export function quoteQueryOptions(
  rfqApiUrl: string,
  cashTokenAddress: string,
  strategy: QuoteStrategy,
  inputs: QuoteInputs,
  request: typeof fetch = fetch,
) {
  return queryOptions({
    queryKey: [
      "quote",
      rfqApiUrl,
      cashTokenAddress,
      strategy,
      inputs.expiryUnixMs,
      inputs.size,
      inputs.strike,
    ] as const,
    queryFn: () => requestQuote(
      rfqApiUrl,
      cashTokenAddress,
      strategy,
      inputs,
      request,
    ),
    retry: false,
  });
}

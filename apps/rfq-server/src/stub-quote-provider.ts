export type QuoteRequest = {
  call_put_marker: 1 | 2;
  cash_token_address: string;
  cash_token_decimals: number;
  collateral_token_address: string;
  collateral_token_decimals: number;
  contracts_qty_decimals: string;
  expiry_unix_ms: number;
  long_short_marker: 2;
  oracle_base_symbol: "BTC";
  oracle_feed_id: string;
  oracle_quote_symbol: "USDC";
  strike_price_decimals: string;
};

const BTC_SPOT_USDC = 63_489;
const RISK_FREE_RATE = 0.04;
const BTC_VOLATILITY = 0.55;

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function blackScholesCall(spot: number, strike: number, years: number) {
  const volatilityTime = BTC_VOLATILITY * Math.sqrt(years);
  const d1 =
    (Math.log(spot / strike) +
      (RISK_FREE_RATE + (BTC_VOLATILITY * BTC_VOLATILITY) / 2) * years) /
    volatilityTime;
  const d2 = d1 - volatilityTime;
  return (
    spot * normalCdf(d1) -
    strike * Math.exp(-RISK_FREE_RATE * years) * normalCdf(d2)
  );
}

function blackScholesPut(spot: number, strike: number, years: number) {
  return (
    blackScholesCall(spot, strike, years) -
    spot +
    strike * Math.exp(-RISK_FREE_RATE * years)
  );
}

export function createStubQuote(
  request: QuoteRequest,
  now = Date.now(),
) {
  const strike = Number(request.strike_price_decimals) / 1_000_000;
  const years = Math.max((request.expiry_unix_ms - now) / 31_536_000_000, 1 / 365);
  const premium = request.call_put_marker === 1
    ? blackScholesCall(BTC_SPOT_USDC, strike, years)
    : blackScholesPut(BTC_SPOT_USDC, strike, years);
  const offerValidUntilUnixMs = Math.min(request.expiry_unix_ms, now + 30_000);

  return {
    domain: "otp:makerquote:v1" as const,
    quote_id: crypto.randomUUID(),
    oracle_base_symbol: request.oracle_base_symbol,
    oracle_quote_symbol: request.oracle_quote_symbol,
    oracle_feed_id: request.oracle_feed_id,
    collateral_token_address: request.collateral_token_address,
    collateral_token_decimals: request.collateral_token_decimals,
    cash_token_address: request.cash_token_address,
    cash_token_decimals: request.cash_token_decimals,
    call_put_marker: request.call_put_marker,
    long_short_marker: request.long_short_marker,
    strike_price_decimals: request.strike_price_decimals,
    expiry_unix_ms: request.expiry_unix_ms,
    signer: "stub-provider",
    cash_premium_per_contract: String(
      Math.max(1, Math.round(premium * 10 ** request.cash_token_decimals)),
    ),
    offer_valid_until_total_contracts_qty_decimals:
      request.contracts_qty_decimals,
    offer_valid_until_unix_ms: offerValidUntilUnixMs,
    maker_id: "server-stub-provider",
  };
}

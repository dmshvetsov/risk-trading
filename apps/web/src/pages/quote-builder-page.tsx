import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { appConfig } from "@/lib/config";

export type DisplayQuote = {
  cashPremiumPerContract: string;
  cashTokenDecimals: number;
  contractsQtyDecimals: string;
  collateralTokenDecimals: number;
  expiryUnixMs: number;
  offerValidUntilUnixMs: number;
  strikePriceDecimals: string;
};

function decimalAmount(value: string, decimals: number) {
  return Number(value) / 10 ** decimals;
}

export function secondsUntilExpiry(expiryUnixMs: number, nowUnixMs: number) {
  return Math.max(0, Math.ceil((expiryUnixMs - nowUnixMs) / 1_000));
}

type QuoteInputs = { expiryUnixMs: number; size: number; strike: number };

export async function requestCoveredCallQuote(
  rfqApiUrl: string,
  cashTokenAddress: string,
  inputs: QuoteInputs,
  request: typeof fetch = fetch,
) {
  const response = await request(`${rfqApiUrl}/api/quotes`, {
    body: JSON.stringify({ request: {
      oracle_base_symbol: "BTC", oracle_quote_symbol: "USDC",
      oracle_feed_id: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
      collateral_token_address: "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC",
      collateral_token_decimals: 8, cash_token_address: cashTokenAddress,
      cash_token_decimals: 6, call_put_marker: 1, long_short_marker: 2,
      strike_price_decimals: String(Math.round(inputs.strike * 1_000_000)),
      expiry_unix_ms: inputs.expiryUnixMs,
      contracts_qty_decimals: String(Math.round(inputs.size * 100_000_000)),
    }}),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Quote request failed");
  const payload = await response.json() as { quote: {
    cash_premium_per_contract: string; cash_token_decimals: number;
    collateral_token_decimals: number; expiry_unix_ms: number;
    offer_valid_until_total_contracts_qty_decimals: string;
    offer_valid_until_unix_ms: number; strike_price_decimals: string;
  }};
  return {
    cashPremiumPerContract: payload.quote.cash_premium_per_contract,
    cashTokenDecimals: payload.quote.cash_token_decimals,
    contractsQtyDecimals: payload.quote.offer_valid_until_total_contracts_qty_decimals,
    collateralTokenDecimals: payload.quote.collateral_token_decimals,
    expiryUnixMs: payload.quote.expiry_unix_ms,
    offerValidUntilUnixMs: payload.quote.offer_valid_until_unix_ms,
    strikePriceDecimals: payload.quote.strike_price_decimals,
  } satisfies DisplayQuote;
}

export function QuoteBuilderView({
  isLoading,
  onSubmit,
  quote,
  nowUnixMs = Date.now(),
}: {
  isLoading: boolean;
  onSubmit(): void;
  quote: DisplayQuote | null;
  nowUnixMs?: number;
}) {
  const collateral = quote
    ? decimalAmount(quote.contractsQtyDecimals, quote.collateralTokenDecimals)
    : 0.05;
  const premium = quote
    ? decimalAmount(quote.cashPremiumPerContract, quote.cashTokenDecimals) * collateral
    : null;
  const strike = quote ? decimalAmount(quote.strikePriceDecimals, 6) : 68_000;
  const secondsLeft = quote
    ? secondsUntilExpiry(quote.offerValidUntilUnixMs, nowUnixMs)
    : 0;

  return (
    <section className="mx-auto grid w-full max-w-[680px] gap-5">
      <header>
        <p className="text-sm text-muted-foreground">Earn upfront yield</p>
        <h1 className="text-3xl font-semibold">Lock WBTC for a chosen date</h1>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="grid gap-4">
        <label className="grid gap-1">Strike price (USDC)<input name="strike" type="number" min="1" step="1" defaultValue="68000" className="border p-3" /></label>
        <label className="grid gap-1">Expiry date<input name="expiry" type="date" required className="border p-3" /></label>
        <label className="grid gap-1">Amount (WBTC)<input name="size" type="number" min="0.05" step="0.05" defaultValue="0.05" className="border p-3" /></label>
        <Button type="submit" size="xl" disabled={isLoading}>{isLoading ? "Getting quote..." : "Get quote"}</Button>
      </form>
      {quote ? (
        <Card>
          <CardHeader><CardTitle>{premium?.toFixed(2)} USDC upfront</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p>Lock {collateral.toFixed(2)} WBTC</p>
            <p>Quote expires in {secondsLeft} seconds</p>
            <p>Keep your WBTC if BTC stays at or below ${strike.toLocaleString()}.</p>
            <p>Receive {(collateral * strike).toLocaleString()} USDC if BTC finishes above ${strike.toLocaleString()}.</p>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

export default function QuoteBuilderPage() {
  const [quote, setQuote] = useState<DisplayQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [nowUnixMs, setNowUnixMs] = useState(Date.now());

  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setNowUnixMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  async function requestQuote(event?: FormEvent) {
    event?.preventDefault();
    const form = document.querySelector("form");
    if (!form) return;
    const data = new FormData(form);
    const strike = Number(data.get("strike"));
    const size = Number(data.get("size"));
    const expiry = new Date(String(data.get("expiry"))).getTime();
    setIsLoading(true);
    try {
      setQuote(await requestCoveredCallQuote(
        appConfig.rfqApiUrl,
        appConfig.cashTokenAddress,
        { expiryUnixMs: expiry, size, strike },
      ));
    } finally { setIsLoading(false); }
  }

  return <QuoteBuilderView isLoading={isLoading} nowUnixMs={nowUnixMs} quote={quote} onSubmit={() => void requestQuote()} />;
}

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { appConfig } from "@/lib/config";
import {
  decimalAmount,
  quoteTerms,
  requestQuote,
  secondsUntilExpiry,
  type DisplayQuote,
  type QuoteStrategy,
} from "@/lib/quote-request";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const strategyOptions = [
  { label: "Covered call", value: "covered-call" },
  { label: "Cash Secured Put", value: "cash-secured-put" },
];

const expiryOptions = [
  { label: "Jun 26", expiryUnixMs: Date.UTC(2026, 5, 26) },
  { label: "Jul 3", expiryUnixMs: Date.UTC(2026, 6, 3) },
  { label: "Jul 10", expiryUnixMs: Date.UTC(2026, 6, 10) },
  { label: "Jul 31", expiryUnixMs: Date.UTC(2026, 6, 31) },
];

const strikeOptions = [
  { label: "$66,000", strike: 66_000 },
  { label: "$67,000", strike: 67_000 },
  { label: "$68,000", strike: 68_000 },
  { label: "$71,000", strike: 71_000 },
  { label: "$75,000", strike: 75_000 },
];

const defaultSize = 0.05;
const defaultExpiryLabel = "Jul 31";
const defaultStrikeLabel = "$68,000";
const btcSpotPrice = 63_489;

function formatUsdc(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(expiryUnixMs: number) {
  return new Date(expiryUnixMs).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysUntil(expiryUnixMs: number, nowUnixMs: number) {
  return Math.max(0, Math.ceil((expiryUnixMs - nowUnixMs) / 86_400_000));
}

function aprFromPremium(
  premium: number | null,
  collateral: number,
  strike: number,
  daysToExpiry: number,
) {
  if (!premium || daysToExpiry <= 0) {
    return null;
  }
  const notional = collateral * strike;
  if (notional <= 0) {
    return null;
  }
  return (premium / notional) * (365 / daysToExpiry) * 100;
}

function SelectorRow({
  options,
  columnsClassName,
  buttonSize,
  selected,
  onSelect,
  disabledOption,
}: {
  options: { label: string }[];
  columnsClassName: string;
  buttonSize: "xl" | "lg";
  selected: string;
  onSelect(label: string): void;
  disabledOption?: string;
}) {
  return (
    <div className={cn("grid gap-2", columnsClassName)}>
      {options.map((option) => (
        <Button
          key={option.label}
          variant={option.label === selected ? "secondary" : "default"}
          size={buttonSize}
          type="button"
          disabled={option.label === disabledOption}
          onClick={() => onSelect(option.label)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function HomePage({ usePlainLink = false }: { usePlainLink?: boolean }) {
  void usePlainLink;

  const [selectedStrategy, setSelectedStrategy] = useState("Covered call");
  const [selectedExpiry, setSelectedExpiry] = useState(defaultExpiryLabel);
  const [selectedStrike, setSelectedStrike] = useState(defaultStrikeLabel);
  const [quote, setQuote] = useState<DisplayQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowUnixMs, setNowUnixMs] = useState(Date.now());

  const expiry = useMemo(
    () =>
      expiryOptions.find((option) => option.label === selectedExpiry) ??
      expiryOptions[0],
    [selectedExpiry],
  );
  const strike = useMemo(
    () =>
      strikeOptions.find((option) => option.label === selectedStrike) ??
      strikeOptions[0],
    [selectedStrike],
  );

  useEffect(() => {
    if (!quote) {
      return;
    }
    const timer = window.setInterval(() => setNowUnixMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  useEffect(() => {
    let cancelled = false;

    async function loadQuote() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const strategy: QuoteStrategy = selectedStrategy === "Covered call"
          ? "covered-call"
          : "cash-secured-put";
        const nextQuote = await requestQuote(
          appConfig.rfqApiUrl,
          appConfig.cashTokenAddress,
          strategy,
          {
            expiryUnixMs: expiry.expiryUnixMs,
            size: defaultSize,
            strike: strike.strike,
          },
        );
        if (!cancelled) {
          setQuote(nextQuote);
          setNowUnixMs(Date.now());
        }
      } catch {
        if (!cancelled) {
          setLoadError("Quote unavailable right now.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadQuote();

    return () => {
      cancelled = true;
    };
  }, [expiry.expiryUnixMs, selectedStrategy, strike.strike]);

  const strategy: QuoteStrategy = selectedStrategy === "Covered call"
    ? "covered-call"
    : "cash-secured-put";
  const premium = quote
    ? decimalAmount(quote.cashPremiumPerContract, quote.cashTokenDecimals) *
      defaultSize
    : null;
  const strikePrice = quote ? decimalAmount(quote.strikePriceDecimals, 6) : strike.strike;
  const terms = quoteTerms(strategy, defaultSize, strikePrice);
  const expiryUnixMs = quote?.expiryUnixMs ?? expiry.expiryUnixMs;
  const offerSecondsLeft = quote
    ? secondsUntilExpiry(quote.offerValidUntilUnixMs, nowUnixMs)
    : 0;
  const expiryLabel = formatDate(expiryUnixMs);
  const daysToExpiry = daysUntil(expiryUnixMs, nowUnixMs);
  const apr = aprFromPremium(
    premium,
    strategy === "covered-call" ? defaultSize : terms.collateralAmount / strikePrice,
    strikePrice,
    daysToExpiry,
  );
  const ctaLabel = isLoading
    ? "LOADING QUOTE..."
    : premium
      ? `EARN ${formatUsdc(premium)} USDC NOW`
      : "QUOTE UNAVAILABLE";

  return (
    <div className="mx-auto grid w-full max-w-[680px] gap-8 sm:gap-10">
      <section className="grid gap-6 sm:gap-5">
        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="size-3 shrink-0 bg-primary" />
            <span>Earn Upfront Yield</span>
          </div>
          <p className="text-base">
            <span className="ml-2 font-semibold text-foreground">WBTC</span>
            <span className="ml-3 font-semibold text-foreground">
              ${formatUsdc(btcSpotPrice)}
            </span>
          </p>
        </div>

        <SelectorRow
          options={strategyOptions}
          columnsClassName="sm:grid-cols-2"
          buttonSize="xl"
          selected={selectedStrategy}
          onSelect={setSelectedStrategy}
        />

        <SelectorRow
          options={expiryOptions}
          columnsClassName="grid-cols-2 lg:grid-cols-4"
          buttonSize="lg"
          selected={selectedExpiry}
          onSelect={setSelectedExpiry}
        />

        <SelectorRow
          options={strikeOptions}
          columnsClassName="grid-cols-2 lg:grid-cols-5 pt-3 sm:pt-5"
          buttonSize="xl"
          selected={selectedStrike}
          onSelect={setSelectedStrike}
        />

        <Card>
          <CardContent className="flex flex-wrap items-center gap-5 px-6 py-5 sm:px-5 sm:py-2">
            <span className="text-l font-semibold">MAX</span>
            <span className="text-l font-semibold">-</span>
            <span className="text-2xl font-semibold tracking-tight">{defaultSize}</span>
            <span className="text-l font-semibold">+</span>
            <span className="ml-auto text-2xl font-semibold">{strategy === "covered-call" ? "WBTC" : "BTC"}</span>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground sm:text-sm">
          Price and Amount at which you are happy to {strategy === "covered-call" ? "sell" : "buy"} BTC on {expiryLabel} in {daysToExpiry} days
        </p>

        <Card>
          <CardContent className="grid gap-0 p-0">
            <div className="grid border-b border-border px-5 py-5 lg:grid-cols-[1.4fr_1fr] lg:items-center">
              <div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span aria-hidden="true" className="size-3 shrink-0 bg-primary" />
                  <span>Now</span>
                </div>
                <p className="text-foreground text-bold">
                  deposit {formatUsdc(terms.collateralAmount)} {terms.collateralSymbol} as collateral
                </p>
              </div>
              <div className="grid text-left lg:text-right">
                <p className="text-muted-foreground">and receive upfront</p>
                <p className="text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  {premium ? `${formatUsdc(premium)} USDC` : isLoading ? "Loading..." : "-"}
                </p>
                <p className="flex items-center gap-1 font-semibold text-foreground lg:justify-end">
                  <span>{apr ? `${apr.toFixed(2)}% APR` : "APR unavailable"}</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-4 items-center justify-center rounded-full border border-border text-muted-foreground"
                          aria-label="annual percentage rate based on 41 days yield"
                        >
                          <Info className="size-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        annual % rate based on selected expiry yield
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </p>
                {quote ? (
                  <p className="text-sm text-muted-foreground">
                    Quote expires in {offerSecondsLeft} seconds
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid px-5 py-5 lg:grid-cols-[1fr_1fr_1fr] lg:items-center">
              <div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span aria-hidden="true" className="size-3 shrink-0 bg-primary" />
                  <span>on {expiryLabel}</span>
                </div>
                <p className="font-normal text-foreground text-sm">one of the two outcomes</p>
              </div>
              <div className="grid border-r-2">
                <p className="font-semibold text-foreground">
                  {strategy === "covered-call" ? "Get" : "Receive"} {terms.downsideAmount.toFixed(2)} {terms.downsideSymbol}{strategy === "covered-call" ? " back" : ""}
                </p>
                <p className="text-foreground text-sm">
                  If BTC below or at ${strikePrice.toLocaleString()}
                </p>
              </div>
              <div className="grid lg:justify-self-end">
                <p className="font-semibold text-foreground">
                  {strategy === "covered-call" ? "Receive" : "Get"} {formatUsdc(terms.upsideAmount)} {terms.upsideSymbol}{strategy === "cash-secured-put" ? " back" : ""}
                </p>
                <p className="text-foreground text-sm">
                  If BTC above ${strikePrice.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button
          variant="cta"
          size="xl"
          disabled={isLoading || !premium}
        >
          {ctaLabel}
        </Button>
        {loadError ? <p className="text-center text-sm text-destructive">{loadError}</p> : null}
      </section>
    </div>
  );
}

export default HomePage;

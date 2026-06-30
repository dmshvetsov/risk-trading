import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useCurrentAccount,
  useCurrentWallet,
  useSuiClient,
} from "@mysten/dapp-kit";
import { ChevronDown, Info } from "lucide-react";
import { PriceUsd } from "@/components/ui/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { appConfig } from "@/lib/config";
import { fetchBtcUsdPythPrice } from "@/lib/oracle";
import {
  decimalAmount,
  quantityToContractsQtyDecimals,
  quotePremiumTotal,
  quoteQueryOptions,
  quoteTerms,
  type QuoteStrategy,
} from "@/lib/quote-request";
import {
  expiryOptionsFromSeries,
  seriesForStrategy,
  seriesGridQueryOptions,
  strikeOptionsForExpiry,
  strikePriceFromDecimals,
} from "@/lib/series-grid";
import {
  executeUnderwrite,
  fetchAllCoins,
  underwriteAvailability,
} from "@/lib/underwrite-flow";
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

const defaultSize = 0.05;
const minSize = 0.005;
const maxSize = 1;
const sizeStep = 0.005;
const sizePresetRows = [
  ["0.005"],
  ["0.01", "0.03", "0.05", "0.07", "0.09"],
  ["0.1", "0.3", "0.5",  "0.7", "0.9"],
  ["1"],
];
const btcSpotPrice = 63_489;
const btcQuantityDecimals = 8n;

export function UnderwriteProgress({ status }: {
  status: "idle" | "preparing" | "queued" | "confirmed" | "failed";
}) {
  if (status === "queued") {
    return <p className="text-center text-sm">Your transaction is pending.</p>;
  }
  if (status === "confirmed") {
    return <p className="text-center text-sm">Your earnings are confirmed.</p>;
  }
  return null;
}

function clampSize(value: number) {
  if (!Number.isFinite(value)) {
    return minSize;
  }

  const clamped = Math.min(maxSize, Math.max(minSize, value));
  return Math.round(clamped / sizeStep) * sizeStep;
}

function formatSize(value: number) {
  return value.toString();
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

function collateralCoinSymbol(strategy: QuoteStrategy) {
  return strategy === "covered-call" ? "TEST_BTC" : "TEST_USDC";
}

function collateralCoinType(
  strategy: QuoteStrategy,
  quoteCoinType: string,
  baseCoinType: string,
) {
  return strategy === "covered-call"
    ? baseCoinType
    : quoteCoinType;
}

function quoteCollateralAmount(
  strategy: QuoteStrategy,
  baseDecimals: number,
  strikeScale: number,
  quote: {
    cashTokenDecimals: number;
    contractsQtyDecimals: string;
    strikePriceDecimals: string;
  } | null,
) {
  if (!quote) {
    return null;
  }
  if (strategy === "covered-call") {
    return BigInt(quote.contractsQtyDecimals);
  }

  const quoteScale = 10n ** BigInt(quote.cashTokenDecimals);
  const denominator = (10n ** BigInt(baseDecimals)) * BigInt(strikeScale);
  return BigInt(quote.contractsQtyDecimals) * BigInt(quote.strikePriceDecimals) * quoteScale /
    denominator;
}

function formatAssetAmount(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 8,
  });
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

  const [isSizeMenuOpen, setIsSizeMenuOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState("Covered call");
  const [selectedExpiryUnixMs, setSelectedExpiryUnixMs] = useState<number | null>(null);
  const [selectedStrikePriceDecimals, setSelectedStrikePriceDecimals] = useState<string | null>(null);
  const [size, setSize] = useState(defaultSize);
  const [nowUnixMs, setNowUnixMs] = useState(Date.now());
  const [underwriteStatus, setUnderwriteStatus] = useState<
    "idle" | "preparing" | "queued" | "confirmed" | "failed"
  >("idle");
  const [underwriteError, setUnderwriteError] = useState<string | null>(null);
  const account = useCurrentAccount();
  const client = useSuiClient();
  const wallet = useCurrentWallet();
  const strategy: QuoteStrategy = selectedStrategy === "Covered call"
    ? "covered-call"
    : "cash-secured-put";
  const seriesGridQuery = useQuery(seriesGridQueryOptions(appConfig.rfqApiUrl));
  const grid = seriesGridQuery.data ?? null;
  const activeSeries = useMemo(
    () => seriesForStrategy(grid, strategy),
    [grid, strategy],
  );
  const expiryOptions = useMemo(
    () => expiryOptionsFromSeries(activeSeries),
    [activeSeries],
  );
  const strikeScale = grid?.market.strikeScale ?? appConfig.strikeScale;
  const selectedExpiry = selectedExpiryUnixMs ?? expiryOptions[0]?.expiryUnixMs ?? null;
  const strikeOptions = useMemo(
    () => strikeOptionsForExpiry(activeSeries, selectedExpiry, strikeScale),
    [activeSeries, selectedExpiry, strikeScale],
  );

  useEffect(() => {
    if (
      selectedExpiryUnixMs !== null &&
      expiryOptions.some((option) => option.expiryUnixMs === selectedExpiryUnixMs)
    ) {
      return;
    }
    setSelectedExpiryUnixMs(expiryOptions[0]?.expiryUnixMs ?? null);
  }, [expiryOptions, selectedExpiryUnixMs]);

  useEffect(() => {
    if (
      selectedStrikePriceDecimals !== null &&
      strikeOptions.some((option) => option.strikePriceDecimals === selectedStrikePriceDecimals)
    ) {
      return;
    }
    setSelectedStrikePriceDecimals(strikeOptions[0]?.strikePriceDecimals ?? null);
  }, [selectedStrikePriceDecimals, strikeOptions]);

  const strike = useMemo(
    () =>
      strikeOptions.find((option) => option.strikePriceDecimals === selectedStrikePriceDecimals) ??
      strikeOptions[0] ??
      null,
    [selectedStrikePriceDecimals, strikeOptions],
  );
  const canRequestQuote = Boolean(grid && selectedExpiry !== null && strike);
  const quoteQuery = useQuery({
    ...quoteQueryOptions(
      appConfig.rfqApiUrl,
      grid?.market ?? {
        baseDecimals: Number(btcQuantityDecimals),
        baseCoinType: appConfig.baseCoinType,
        oracleBaseSymbol: "BTC",
        oracleFeedId: "",
        oracleQuoteSymbol: "USDC",
        quoteDecimals: 6,
        quoteCoinType: appConfig.cashTokenAddress,
      },
      strategy,
      {
        expiryUnixMs: selectedExpiry ?? 0,
        size,
        strikePriceDecimals: strike?.strikePriceDecimals ?? "0",
      },
    ),
    enabled: canRequestQuote,
  });
  const btcSpotPriceQuery = useQuery({
    queryFn: () => fetchBtcUsdPythPrice(),
    queryKey: ["pyth-price", "btc-usd"],
    refetchInterval: 15_000,
    retry: 1,
    staleTime: 15_000,
  });
  const isSupportedUnderwrite = appConfig.network === "testnet" && canRequestQuote;
  const selectedCollateralCoinType = grid
    ? collateralCoinType(strategy, grid.market.quoteCoinType, grid.market.baseCoinType)
    : collateralCoinType(strategy, appConfig.cashTokenAddress, appConfig.baseCoinType);
  const coinsQuery = useQuery({
    enabled: Boolean(account && isSupportedUnderwrite),
    queryFn: () => fetchAllCoins(client, account!.address, selectedCollateralCoinType),
    queryKey: ["underwrite-coins", account?.address, strategy, selectedCollateralCoinType],
  });
  const quote = quoteQuery.isError ? null : quoteQuery.data ?? null;
  const baseDecimals = grid?.market.baseDecimals ?? Number(btcQuantityDecimals);
  const collateralAmount = quoteCollateralAmount(strategy, baseDecimals, strikeScale, quote) ??
    BigInt(quantityToContractsQtyDecimals(size, baseDecimals));
  const availability = underwriteAvailability(
    coinsQuery.data,
    collateralAmount,
    collateralCoinSymbol(strategy),
  );
  const isLoading = quoteQuery.isFetching;
  const loadError = seriesGridQuery.isError
    ? "Prices unavailable right now."
    : quoteQuery.isError
      ? "Quote unavailable right now."
      : null;
  const displayedBtcSpotPrice = grid?.spot.price ?? btcSpotPriceQuery.data?.price ?? btcSpotPrice;

  useEffect(() => {
    if (!quote) {
      return;
    }
    setNowUnixMs(Date.now());
    const timer = window.setInterval(() => setNowUnixMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);
  const effectiveSize = quote
    ? decimalAmount(quote.contractsQtyDecimals, baseDecimals)
    : size;
  const premium = quote
    ? quotePremiumTotal(
      quote.cashPremiumPerContract,
      quote.contractsQtyDecimals,
      quote.cashTokenDecimals,
    )
    : null;
  const strikePrice = quote
    ? decimalAmount(quote.strikePriceDecimals, Math.log10(strikeScale))
    : strike
      ? strikePriceFromDecimals(strike.strikePriceDecimals, strikeScale)
      : 0;
  const terms = quoteTerms(strategy, effectiveSize, strikePrice);
  const expiryUnixMs = quote?.expiryUnixMs ?? selectedExpiry ?? Date.now();
  const expiryLabel = formatDate(expiryUnixMs);
  const daysToExpiry = daysUntil(expiryUnixMs, nowUnixMs);
  const apr = aprFromPremium(
    premium,
    strategy === "covered-call" ? effectiveSize : terms.collateralAmount / strikePrice,
    strikePrice,
    daysToExpiry,
  );
  const ctaLabel = isLoading
    ? "LOADING QUOTE..."
    : premium
      ? <>EARN <PriceUsd value={premium} /> USDC NOW</>
      : "QUOTE UNAVAILABLE";
  const isUnderwritePending = underwriteStatus === "preparing" || underwriteStatus === "queued";
  const earnDisabled = isLoading || !premium || !account || !isSupportedUnderwrite ||
    coinsQuery.isFetching || !availability.enabled || isUnderwritePending;
  const earnLabel = !account
    ? "CONNECT WALLET TO EARN"
    : !isSupportedUnderwrite
      ? "CONNECT TO TESTNET SERIES"
      : coinsQuery.isFetching
        ? `CHECKING ${collateralCoinSymbol(strategy)}...`
        : !availability.enabled
          ? availability.label
          : underwriteStatus === "preparing"
            ? "WAITING FOR WALLET..."
            : underwriteStatus === "queued"
              ? "TRANSACTION PENDING..."
              : underwriteStatus === "confirmed"
                ? "EARNINGS CONFIRMED"
                : underwriteStatus === "failed"
                  ? "TRY AGAIN"
                  : ctaLabel;

  async function earnNow() {
    if (!account || !quote || !coinsQuery.data || earnDisabled) return;
    setUnderwriteError(null);
    setUnderwriteStatus("preparing");
    try {
      const quantity = quantityToContractsQtyDecimals(size, baseDecimals);
      await executeUnderwrite({
        coins: coinsQuery.data,
        contractsQtyDecimals: quantity,
        onStatus: setUnderwriteStatus,
        quote: quote.quote,
        quoteSignature: quote.quoteSignature,
        rfqApiUrl: appConfig.rfqApiUrl,
        seller: account.address,
        signTransaction: async (transaction) => {
          const signTransactionFeature =
            wallet.currentWallet?.features["sui:signTransaction"]?.signTransaction;
          const signTransactionBlock =
            wallet.currentWallet?.features["sui:signTransactionBlock"]?.signTransactionBlock;
          if (signTransactionFeature) {
            const signed = await signTransactionFeature({
              account,
              chain: `sui:${appConfig.network}`,
              transaction,
            });
            return {
              bytes: signed.bytes,
              signature: signed.signature,
            };
          }
          if (!signTransactionBlock) {
            throw new Error("Connected wallet does not support transaction-block signing");
          }
          const signed = await signTransactionBlock({
            account,
            chain: `sui:${appConfig.network}`,
            transactionBlock: transaction,
          });
          return {
            bytes: signed.transactionBlockBytes,
            signature: signed.signature,
          };
        },
      });
    } catch (error) {
      setUnderwriteError(error instanceof Error ? error.message : "Transaction failed");
      setUnderwriteStatus("failed");
    }
  }

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
            <span className="ml-3 font-semibold text-foreground font-numbers">
              <PriceUsd value={displayedBtcSpotPrice} />
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

        <div className="flex justify-between gap-2">
          {expiryOptions.map((option) => (
            <Button
              key={option.label}
              variant={option.expiryUnixMs === selectedExpiry? "secondary" : "default"}
              size="lg"
              type="button"
              className="flex-grow"
              onClick={() => {
                const nextExpiry = expiryOptions.find((exp) => exp.label === option.label);
                setSelectedExpiryUnixMs(nextExpiry?.expiryUnixMs ?? null);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex justify-between gap-2 pt-3 sm:pt-5">
          {strikeOptions.map((option) => (
            <Button
              key={option.label}
              variant={option.strike === strike.strike ? "secondary" : "default"}
              size="xl"
              type="button"
              className="flex-grow"
              onClick={() => {
                // const nextExpiry = expiryOptions.find((exp) => exp.label === option.label);
                // setSelectedExpiryUnixMs(nextExpiry?.expiryUnixMs ?? null);
            const nextStrike = strikeOptions.find((strk) => strk.label === option.label);
            setSelectedStrikePriceDecimals(nextStrike?.strikePriceDecimals ?? null);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center px-6 py-5 sm:px-5 sm:py-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="px-2 text-base font-semibold"
              onClick={() => setSize(maxSize)}
            >
              MAX
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="text-base font-semibold"
              onClick={() => setSize((current) => clampSize(current - sizeStep))}
            >
              -
            </Button>
            <DropdownMenu open={isSizeMenuOpen} onOpenChange={setIsSizeMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="h-auto gap-2 text-2xl font-semibold tracking-tight w-[100px]"
                >
                  <span>{formatSize(size)}</span>
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="center"
                className="w-auto min-w-0"
              >
                <div className="grid">
                  {sizePresetRows.map((row) => (
                    <div
                      key={row.join("-")}
                      className="flex flex-wrap justify-center"
                    >
                      {row.map((preset) => {
                        const presetValue = Number(preset);
                        const isSelected = size === presetValue;

                        return (
                          <Button
                            key={preset}
                            variant="ghost"
                            className={cn(
                              "w-[75px]",
                              isSelected
                                ? "bg-foreground text-background"
                                : "bg-background text-foreground hover:bg-accent",
                            )}
                            onClick={() => {
                              setSize(presetValue);
                              setIsSizeMenuOpen(false);
                            }}
                          >
                            {preset}
                          </Button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="text-base font-semibold"
              onClick={() => setSize((current) => clampSize(current + sizeStep))}
            >
              +
            </Button>
            <span className="ml-auto text-2xl font-semibold">WBTC</span>
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
                  deposit {formatAssetAmount(terms.collateralAmount)} {terms.collateralSymbol} as collateral
                </p>
              </div>
              <div className="grid text-left lg:text-right">
                <p className="text-muted-foreground">and receive upfront</p>
                <p className="text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  {premium ? <><PriceUsd value={premium} /> USDC</> : isLoading ? "Loading..." : "-"}
                </p>
                <p className="flex items-center gap-1 text-foreground lg:justify-end">
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
                  {strategy === "covered-call" ? "Receive" : "Get"} <PriceUsd value={terms.upsideAmount} /> {terms.upsideSymbol}{strategy === "cash-secured-put" ? " back" : ""}
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
          disabled={earnDisabled}
          onClick={() => void earnNow()}
        >
          {earnLabel}
        </Button>
        <UnderwriteProgress status={underwriteStatus} />
        {underwriteError ? <p className="text-center text-sm text-destructive">{underwriteError}</p> : null}
        {loadError ? <p className="text-center text-sm text-destructive">{loadError}</p> : null}
      </section>
    </div>
  );
}

export default HomePage;

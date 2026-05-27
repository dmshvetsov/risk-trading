import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Minus, Plus, RefreshCw } from "lucide-react";
import type React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  FLOAT_SCALING,
  DEEPBOOK_PREDICT,
  buildSviCurve,
  createDepositAndMintPositionTransaction,
  createManagerTransaction,
  decodeSignedScaled,
  getSuiExplorerTxUrl,
  getWalletVaultBalances,
  getWalletPredictManager,
  getOracleState,
  getOracleTradeAmounts,
  type OracleTradeAmounts,
  type PredictManagerSummary,
  type OracleStateResponse,
  type SviPoint,
  type WalletVaultBalances,
} from "@/lib/deepbook-predict";
import {
  formatDate,
  formatTickValue,
  formatTokenAmount,
  truncateAddress,
} from "@/lib/format";

export const Route = createFileRoute("/oracles/$oracleId")({
  component: OraclePage,
});

const chartConfig = {
  upFair: {
    label: "UP fair",
    color: "var(--chart-1)",
  },
  dnFair: {
    label: "DN fair",
    color: "var(--chart-2)",
  },
  totalVariance: {
    label: "Total variance",
    color: "var(--chart-3)",
  },
  impliedVol: {
    label: "Implied vol",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig;

const ORACLE_REFRESH_INTERVAL_MS = 30_000;
const MANAGER_INDEX_POLL_INTERVAL_MS = 5_000;
const TRADE_PREVIEW_DEBOUNCE_MS = 350;
const TRADE_PREVIEW_REFRESH_INTERVAL_MS = 5_000;
const TRADE_PREVIEW_STALE_AFTER_MS = 15_000;
const TRADE_PREVIEW_UNIT_QUANTITY = 1_000_000n;
const PREVIEW_STRIKE_ROUNDING_USD = 1_000;
const PREVIEW_STRIKE_STEP_USD = 2_000;
const PREVIEW_STRIKE_STEPS_EACH_SIDE = 8;

type TradePreviewInput = {
  expiry: number;
  isUp: boolean;
  oracleId: string;
  quantity: bigint;
  strike: number;
};

type PreviewStrikeRow = Pick<SviPoint, "strike">;

function OraclePage() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction, isPending: isTxPending } =
    useSignAndExecuteTransaction();
  const { oracleId } = Route.useParams();
  const [state, setState] = useState<OracleStateResponse | null>(null);
  const [manager, setManager] = useState<PredictManagerSummary | null>(null);
  const [walletBalances, setWalletBalances] =
    useState<WalletVaultBalances | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isManagerLoading, setIsManagerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerTxDigest, setManagerTxDigest] = useState<string | null>(null);
  const [tradeTxDigest, setTradeTxDigest] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [previewIsUp, setPreviewIsUp] = useState(true);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [tradeAmounts, setTradeAmounts] = useState<OracleTradeAmounts | null>(
    null,
  );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRefreshedAt, setPreviewRefreshedAt] = useState<number | null>(
    null,
  );
  const [isTradePreviewStale, setIsTradePreviewStale] = useState(false);
  const oracleRequestIdRef = useRef(0);
  const managerRequestIdRef = useRef(0);
  const tradePreviewRequestIdRef = useRef(0);

  async function loadOracleState(showLoading: boolean, signal?: AbortSignal) {
    const requestId = (oracleRequestIdRef.current += 1);

    if (showLoading) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const oracleState = await getOracleState(oracleId, signal);

      if (!signal?.aborted && requestId === oracleRequestIdRef.current) {
        setState(oracleState);
        setError(null);
      }
    } catch (caughtError) {
      if (
        !isAbortError(caughtError) &&
        !signal?.aborted &&
        requestId === oracleRequestIdRef.current &&
        showLoading
      ) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load oracle",
        );
      }
    } finally {
      if (!signal?.aborted && requestId === oracleRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    const abortController = new AbortController();
    let timeoutId: number | undefined;

    const scheduleRefresh = () => {
      timeoutId = window.setTimeout(() => {
        void loadOracleState(false, abortController.signal).finally(() => {
          if (!abortController.signal.aborted) {
            scheduleRefresh();
          }
        });
      }, ORACLE_REFRESH_INTERVAL_MS);
    };

    void loadOracleState(true, abortController.signal).finally(() => {
      if (!abortController.signal.aborted) {
        scheduleRefresh();
      }
    });

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [oracleId]);

  const curve = useMemo(() => (state ? buildSviCurve(state) : []), [state]);
  const tableRows = useMemo(() => selectDecisionRows(curve), [curve]);
  const previewStrikeRows = useMemo(
    () => (state ? buildPreviewStrikeRows(state) : []),
    [state?.latest_price?.spot, state?.oracle.min_strike, state?.oracle.tick_size],
  );
  const showTradePreview = Boolean(
    state && isTradePreviewRenderable(state) && previewStrikeRows.length > 0,
  );
  const isSelectedStrikeUnavailable = Boolean(
    selectedStrike !== null &&
      showTradePreview &&
      !previewStrikeRows.some((row) => row.strike === selectedStrike),
  );
  const parsedQuantity = useMemo(() => {
    try {
      return parseContractQuantity(quantity);
    } catch {
      return null;
    }
  }, [quantity]);
  const contractQuantity =
    parsedQuantity === null ? null : parsedQuantity * TRADE_PREVIEW_UNIT_QUANTITY;
  const tradePreviewInput = useMemo<TradePreviewInput | null>(() => {
    if (
      !state ||
      state.oracle.oracle_id !== oracleId ||
      !showTradePreview ||
      selectedStrike === null ||
      isSelectedStrikeUnavailable ||
      parsedQuantity === null ||
      parsedQuantity === 0n
    ) {
      return null;
    }

    return {
      expiry: state.oracle.expiry,
      isUp: previewIsUp,
      oracleId: state.oracle.oracle_id,
      quantity: parsedQuantity,
      strike: selectedStrike,
    };
  }, [
    parsedQuantity,
    oracleId,
    previewIsUp,
    selectedStrike,
    isSelectedStrikeUnavailable,
    showTradePreview,
    state?.oracle.expiry,
    state?.oracle.oracle_id,
  ]);
  const fundingPlan = useMemo(
    () => getFundingPlan(manager, walletBalances, tradeAmounts?.mintCost),
    [manager, tradeAmounts?.mintCost, walletBalances],
  );
  const askBoundsValidationError = useMemo(() => {
    if (
      !state?.ask_bounds ||
      !tradeAmounts ||
      contractQuantity === null ||
      contractQuantity === 0n
    ) {
      return null;
    }

    const askPrice = getScaledAskPrice(tradeAmounts.mintCost, contractQuantity);
    const minAsk = BigInt(Math.trunc(state.ask_bounds.min_ask_price));
    const maxAsk = BigInt(Math.trunc(state.ask_bounds.max_ask_price));

    if (askPrice < minAsk || askPrice > maxAsk) {
      return `Ask ${formatProbability(Number(askPrice))} is outside bounds ${formatProbability(
        state.ask_bounds.min_ask_price,
      )} - ${formatProbability(state.ask_bounds.max_ask_price)}`;
    }

    return null;
  }, [contractQuantity, state?.ask_bounds, tradeAmounts]);
  const tradeValidationError = useMemo(() => {
    if (!account) {
      return "Connect a wallet";
    }

    if (!manager) {
      return "Create manager";
    }

    if (!walletBalances) {
      return "Loading wallet balance";
    }

    if (!state || !isTradePreviewRenderable(state)) {
      return "Oracle is not tradable";
    }

    if (selectedStrike === null) {
      return "Select a strike";
    }

    if (isSelectedStrikeUnavailable) {
      return "Strike unavailable";
    }

    if (parsedQuantity === null || parsedQuantity === 0n || contractQuantity === null) {
      return "Enter a quantity";
    }

    if (!tradeAmounts) {
      return isPreviewLoading ? "Loading quote" : "Quote unavailable";
    }

    if (isTradePreviewStale) {
      return "Refresh quote";
    }

    if (askBoundsValidationError) {
      return askBoundsValidationError;
    }

    if (fundingPlan.walletDeficit > 0n) {
      return `Need ${formatManagerQuote(fundingPlan.walletDeficit)} more in wallet`;
    }

    return null;
  }, [
    account,
    askBoundsValidationError,
    contractQuantity,
    fundingPlan.walletDeficit,
    isPreviewLoading,
    isSelectedStrikeUnavailable,
    isTradePreviewStale,
    manager,
    parsedQuantity,
    selectedStrike,
    state,
    tradeAmounts,
    walletBalances,
  ]);

  async function loadManager(signal?: AbortSignal) {
    const requestId = (managerRequestIdRef.current += 1);

    if (!account) {
      setManager(null);
      setWalletBalances(null);
      setManagerError(null);
      setIsManagerLoading(false);
      return;
    }

    setIsManagerLoading(true);
    setManagerError(null);

    try {
      const [nextManager, nextWalletBalances] = await Promise.all([
        getWalletPredictManager(client, account.address, signal),
        getWalletVaultBalances(client, account.address),
      ]);
      if (signal?.aborted || requestId !== managerRequestIdRef.current) {
        return;
      }

      setManager(nextManager);
      setWalletBalances(nextWalletBalances);

      if (nextManager) {
        setManagerTxDigest(null);
      }
    } catch (caughtError) {
      if (isAbortError(caughtError) || signal?.aborted) {
        return;
      }

      setManagerError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to load PredictManager",
      );
    } finally {
      if (!signal?.aborted && requestId === managerRequestIdRef.current) {
        setIsManagerLoading(false);
      }
    }
  }

  async function refreshTradingState() {
    await Promise.all([loadManager(), loadOracleState(false)]);
  }

  async function loadTradePreview(
    input: TradePreviewInput,
    requestId: number,
    clearOnError: boolean,
    isCancelled: () => boolean,
  ) {
    try {
      const amounts = await getOracleTradeAmounts(client, {
        expiry: input.expiry,
        isUp: input.isUp,
        oracleId: input.oracleId,
        quantity: TRADE_PREVIEW_UNIT_QUANTITY,
        strike: input.strike,
      });

      if (!isCancelled() && requestId === tradePreviewRequestIdRef.current) {
        setTradeAmounts(scaleTradeAmounts(amounts, input.quantity));
        setPreviewRefreshedAt(Date.now());
        setIsTradePreviewStale(false);
        setPreviewError(null);
      }
    } catch (caughtError) {
      if (!isCancelled() && requestId === tradePreviewRequestIdRef.current) {
        if (clearOnError) {
          setTradeAmounts(null);
          setPreviewRefreshedAt(null);
          setIsTradePreviewStale(false);
        }

        setPreviewError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load trade preview",
        );
      }
    } finally {
      if (!isCancelled() && requestId === tradePreviewRequestIdRef.current) {
        setIsPreviewLoading(false);
      }
    }
  }

  useEffect(() => {
    const abortController = new AbortController();

    void loadManager(abortController.signal);

    return () => abortController.abort();
  }, [account?.address, client]);

  useEffect(() => {
    if (!account || manager || !managerTxDigest) {
      return;
    }

    const abortController = new AbortController();
    let timeoutId: number | undefined;

    const scheduleRefresh = () => {
      timeoutId = window.setTimeout(() => {
        void loadManager(abortController.signal).finally(() => {
          if (!abortController.signal.aborted) {
            scheduleRefresh();
          }
        });
      }, MANAGER_INDEX_POLL_INTERVAL_MS);
    };

    scheduleRefresh();

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [account?.address, client, manager, managerTxDigest]);

  useEffect(() => {
    if (!showTradePreview) {
      setSelectedStrike(null);
      return;
    }

    if (selectedStrike === null) {
      setSelectedStrike(
        nearestPreviewStrike(previewStrikeRows, state?.latest_price?.spot),
      );
    }
  }, [previewStrikeRows, selectedStrike, showTradePreview, state?.latest_price?.spot]);

  useEffect(() => {
    if (!tradePreviewInput) {
      setTradeAmounts(null);
      setPreviewError(null);
      setPreviewRefreshedAt(null);
      setIsTradePreviewStale(false);
      setIsPreviewLoading(false);
      return;
    }

    let isCancelled = false;
    const requestId = (tradePreviewRequestIdRef.current += 1);
    setIsPreviewLoading(true);
    setPreviewError(null);

    const timeoutId = window.setTimeout(() => {
      void loadTradePreview(tradePreviewInput, requestId, true, () => isCancelled);
    }, TRADE_PREVIEW_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [client, tradePreviewInput]);

  useEffect(() => {
    if (!tradePreviewInput) {
      return;
    }

    let isCancelled = false;
    let timeoutId: number | undefined;

    const scheduleRefresh = () => {
      timeoutId = window.setTimeout(() => {
        const requestId = (tradePreviewRequestIdRef.current += 1);
        setIsPreviewLoading(true);
        setPreviewError(null);
        void loadTradePreview(tradePreviewInput, requestId, false, () => isCancelled)
          .finally(() => {
            if (!isCancelled) {
              scheduleRefresh();
            }
          });
      }, TRADE_PREVIEW_REFRESH_INTERVAL_MS);
    };

    scheduleRefresh();

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [client, tradePreviewInput]);

  useEffect(() => {
    if (!tradeAmounts || previewRefreshedAt === null) {
      setIsTradePreviewStale(false);
      return;
    }

    const staleInMs = Math.max(
      0,
      TRADE_PREVIEW_STALE_AFTER_MS - (Date.now() - previewRefreshedAt),
    );
    const timeoutId = window.setTimeout(() => {
      setIsTradePreviewStale(true);
    }, staleInMs);

    return () => window.clearTimeout(timeoutId);
  }, [previewRefreshedAt, tradeAmounts]);

  if (isLoading) {
    return <PageShell title="Oracle" description="Loading oracle state..." />;
  }

  if (error || !state) {
    return (
      <PageShell
        title="Oracle"
        description={error ?? "Unable to load oracle state."}
      />
    );
  }

  const { oracle, latest_price: price, latest_svi: svi } = state;
  const spot = price?.spot ?? null;
  const forward = price?.forward ?? null;
  const isSettled = oracle.status === "settled";

  function adjustQuantity(delta: number) {
    const currentQuantity = Number(quantity);
    const nextQuantity = Math.max(
      0,
      (Number.isFinite(currentQuantity) ? currentQuantity : 0) + delta,
    );

    setQuantity(formatQuantityInput(nextQuantity));
  }

  async function createManager() {
    if (!account) {
      return;
    }

    setManagerError(null);

    try {
      const result = await signAndExecuteTransaction({
        transaction: createManagerTransaction(),
        chain: "sui:testnet",
      });

      setManagerTxDigest(result.digest);
      await loadManager();
    } catch (caughtError) {
      setManagerError(
        caughtError instanceof Error
          ? caughtError.message
          : "Manager creation failed",
      );
    }
  }

  async function openPosition() {
    if (
      !account ||
      !manager ||
      !state ||
      !tradeAmounts ||
      selectedStrike === null ||
      contractQuantity === null ||
      tradeValidationError
    ) {
      return;
    }

    setTradeError(null);
    setTradeTxDigest(null);

    try {
      const result = await signAndExecuteTransaction({
        transaction: createDepositAndMintPositionTransaction({
          depositAmount: fundingPlan.requiredWalletDeposit,
          expiry: state.oracle.expiry,
          isUp: previewIsUp,
          managerId: manager.id,
          oracleId: state.oracle.oracle_id,
          oracleSviId: state.oracle.oracle_id,
          quantity: contractQuantity,
          strike: selectedStrike,
        }),
        chain: "sui:testnet",
      });

      setTradeTxDigest(result.digest);
      await refreshTradingState();
    } catch (caughtError) {
      setTradeError(
        caughtError instanceof Error ? caughtError.message : "Trade failed",
      );
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              {oracle.underlying_asset} binary prediction / expiration {formatDate(oracle.expiry)}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge>{oracle.status}</Badge>
              <Badge>{oracle.oracle_id}</Badge>
              {isSettled && oracle.settlement_price !== null ? (
                <Badge>
                  settled{" "}
                  {formatTickValue(oracle.settlement_price, oracle.tick_size)}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Metric
              label="Spot"
              value={formatTickValue(spot, oracle.tick_size, {
                maximumFractionDigits:
                  oracle.underlying_asset.toUpperCase() === "BTC" ? 0 : 4,
              })}
            />
            <Metric
              label="Forward"
              value={formatTickValue(forward, oracle.tick_size, {
                maximumFractionDigits:
                  oracle.underlying_asset.toUpperCase() === "BTC" ? 0 : 4,
              })}
            />
          </div>
        </div>

        <PredictManagerPanel
          accountAddress={account?.address}
          error={managerError}
          isCreating={isTxPending}
          isLoading={isManagerLoading}
          manager={manager}
          onCreate={() => void createManager()}
          onRefresh={() => void loadManager()}
          txDigest={managerTxDigest}
        />

        {showTradePreview ? (
          <Panel title="Trade Cost Preview">
            <div className="grid gap-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div className="grid gap-2">
                  <Label htmlFor="trade-preview-quantity">Quantity</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      aria-label="Decrease quantity"
                      onClick={() => adjustQuantity(-1)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <Minus aria-hidden="true" />
                    </Button>
                    <Input
                      className="font-mono"
                      id="trade-preview-quantity"
                      inputMode="numeric"
                      onChange={(event) => setQuantity(event.target.value)}
                      placeholder="1"
                      value={quantity}
                    />
                    <Button
                      aria-label="Increase quantity"
                      onClick={() => adjustQuantity(1)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="flex h-9 items-center gap-3 rounded-md border border-border px-3">
                  <span
                    className={`text-sm ${
                      previewIsUp ? "text-muted-foreground" : "font-medium"
                    }`}
                  >
                    DOWN
                  </span>
                  <Switch
                    aria-label="Show UP strike prices"
                    checked={previewIsUp}
                    onCheckedChange={setPreviewIsUp}
                  />
                  <span
                    className={`text-sm ${
                      previewIsUp ? "font-medium" : "text-muted-foreground"
                    }`}
                  >
                    UP
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {previewStrikeRows.map((row) => (
                  <Button
                    key={row.strike}
                    onClick={() => setSelectedStrike(row.strike)}
                    size="sm"
                    type="button"
                    variant={selectedStrike === row.strike ? "default" : "outline"}
                  >
                    {formatTickValue(row.strike, oracle.tick_size)}
                  </Button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Metric
                  label="Estimated cost"
                  value={formatTradeAmount(tradeAmounts?.mintCost, isPreviewLoading)}
                />
                <Metric
                  label="Redeem payout"
                  value={formatTradeAmount(
                    tradeAmounts?.redeemPayout,
                    isPreviewLoading,
                  )}
                />
                <Metric
                  label={`Wallet ${DEEPBOOK_PREDICT.quote.symbol}`}
                  value={
                    account
                      ? formatManagerQuote(walletBalances?.quote ?? 0n)
                      : "Connect"
                  }
                />
              </div>

              {parsedQuantity === null || parsedQuantity === 0n ? (
                <div className="text-sm text-destructive">Enter a quantity.</div>
              ) : previewError ? (
                <div className="text-sm text-destructive">{previewError}</div>
              ) : isTradePreviewStale ? (
                <div className="text-sm text-destructive">
                  Quote is stale. Wait for the next refresh before signing.
                </div>
              ) : askBoundsValidationError ? (
                <div className="text-sm text-destructive">
                  {askBoundsValidationError}
                </div>
              ) : (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>
                    Amounts are shown in {DEEPBOOK_PREDICT.quote.symbol}.
                  </div>
                  <div>
                    Formula: estimated cost = protocol ask price x quantity;
                    redeem payout = protocol bid price x quantity.
                  </div>
                </div>
              )}

              {tradeError ? (
                <div className="text-sm text-destructive">{tradeError}</div>
              ) : null}

              {tradeTxDigest ? (
                <a
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  href={getSuiExplorerTxUrl(tradeTxDigest)}
                  rel="noreferrer"
                  target="_blank"
                >
                  View transaction
                  <ExternalLink className="size-4" aria-hidden="true" />
                </a>
              ) : null}

              <Button
                disabled={isTxPending || Boolean(tradeValidationError)}
                onClick={() => void openPosition()}
                type="button"
              >
                {isTxPending ? "Waiting for wallet" : tradeValidationError ?? "Open position"}
              </Button>
            </div>
          </Panel>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          <FairProbabilityCurvePanel
            curve={curve}
            forward={forward}
            tickSize={oracle.tick_size}
          />

          <Panel title="SVI Parameters">
            {svi ? (
              <div className="grid gap-3">
                <Parameter
                  hint="Base variance level"
                  label="a"
                  value={scaled(svi.a)}
                />
                <Parameter
                  hint="Smile slope / wing steepness"
                  label="b"
                  value={scaled(svi.b)}
                />
                <Parameter
                  hint="Skew correlation"
                  label="rho"
                  value={decodeSignedScaled(svi.rho, svi.rho_negative).toFixed(6)}
                />
                <Parameter
                  hint="Smile center / log-moneyness shift"
                  label="m"
                  value={decodeSignedScaled(svi.m, svi.m_negative).toFixed(6)}
                />
                <Parameter
                  hint="Smile curvature / smoothness"
                  label="sigma"
                  value={scaled(svi.sigma)}
                />
                <div className="mt-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  SVI update {formatDate(svi.onchain_timestamp)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Price update{" "}
                  {price ? formatDate(price.onchain_timestamp) : "n/a"}
                </div>
              </div>
            ) : (
              <EmptyState>No SVI update found.</EmptyState>
            )}
          </Panel>
        </section>

        <section>
          <SviSmilePanel curve={curve} tickSize={oracle.tick_size} />
        </section>

        <Panel title="Strike Decision Table">
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b border-border">
                  <Th>Strike</Th>
                  <Th>K</Th>
                  <Th>UP fair</Th>
                  <Th>DN fair</Th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr
                    className="border-b border-border transition-colors hover:bg-muted/50"
                    key={row.strike}
                  >
                    <Td strong>
                      {formatTickValue(row.strike, oracle.tick_size)}
                    </Td>
                    <Td>{row.k.toFixed(5)}</Td>
                    <Td>{percent(row.upFair)}</Td>
                    <Td>{percent(row.dnFair)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </main>
  );
}

function PageShell({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </main>
  );
}

function Panel({
  action,
  title,
  children,
}: {
  action?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

const FairProbabilityCurvePanel = memo(function FairProbabilityCurvePanel({
  curve,
  forward,
  tickSize,
}: {
  curve: Array<SviPoint>;
  forward: number | null;
  tickSize: number;
}) {
  return (
    <Panel
      title="Fair Probability Curve"
      action={
        <div className="flex flex-wrap gap-3 text-xs">
          <LegendItem color="var(--chart-1)" label="UP fair">
            Chance settlement finishes above strike.
          </LegendItem>
          <LegendItem color="var(--chart-2)" label="DN fair">
            Chance settlement finishes at or below strike.
          </LegendItem>
          <LegendItem color="var(--muted-foreground)" dashed label="Forward">
            Reference strike used by the SVI pricing curve.
          </LegendItem>
        </div>
      }
    >
      <ChartContainer config={chartConfig} className="h-80 w-full">
        <LineChart data={curve} margin={{ left: 8, right: 16, top: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="strike"
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value) => formatTickValue(Number(value), tickSize)}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`}
          />
          {forward ? (
            <ReferenceLine
              x={nearestStrike(curve, forward)}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
            />
          ) : null}
          <Tooltip
            isAnimationActive={false}
            content={
              <ChartTooltipContent
                valueFormatter={(value) =>
                  `${(Number(value) * 100).toFixed(4)}%`
                }
              />
            }
          />
          <Line
            dataKey="upFair"
            dot={false}
            isAnimationActive={false}
            stroke="var(--color-upFair)"
            strokeWidth={2}
            type="monotone"
          />
          <Line
            dataKey="dnFair"
            dot={false}
            isAnimationActive={false}
            stroke="var(--color-dnFair)"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ChartContainer>
    </Panel>
  );
});

const SviSmilePanel = memo(function SviSmilePanel({
  curve,
  tickSize,
}: {
  curve: Array<SviPoint>;
  tickSize: number;
}) {
  return (
    <Panel title="SVI Smile">
      <ChartContainer config={chartConfig} className="h-72 w-full">
        <LineChart data={curve} margin={{ left: 8, right: 16, top: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="strike"
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value) => formatTickValue(Number(value), tickSize)}
          />
          <YAxis tickFormatter={(value) => Number(value).toExponential(1)} />
          <Tooltip
            isAnimationActive={false}
            content={
              <ChartTooltipContent
                valueFormatter={(value) => Number(value).toExponential(4)}
              />
            }
          />
          <Line
            dataKey="totalVariance"
            dot={false}
            isAnimationActive={false}
            stroke="var(--color-totalVariance)"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ChartContainer>
    </Panel>
  );
});

function PredictManagerPanel({
  accountAddress,
  error,
  isCreating,
  isLoading,
  manager,
  onCreate,
  onRefresh,
  txDigest,
}: {
  accountAddress: string | undefined;
  error: string | null;
  isCreating: boolean;
  isLoading: boolean;
  manager: PredictManagerSummary | null;
  onCreate: () => void;
  onRefresh: () => void;
  txDigest: string | null;
}) {
  const status = getManagerStatus({
    accountAddress,
    error,
    isLoading,
    manager,
    txDigest,
  });

  return (
    <Panel
      title="Trading Account"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <ConnectButton />
          {accountAddress ? (
            <Button
              disabled={isLoading}
              onClick={onRefresh}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Status" value={status} />
          <Metric
            label="Manager"
            value={manager ? truncateAddress(manager.id) : "-"}
          />
          <Metric
            label={`${DEEPBOOK_PREDICT.quote.symbol} balance`}
            value={
              manager
                ? formatManagerQuote(manager.quoteBalance)
                : accountAddress
                  ? "-"
                  : "Connect"
            }
          />
          <Metric
            label="Position state"
            value={
              manager
                ? manager.hasPositions
                  ? `${manager.positionsSize + manager.rangePositionsSize} active`
                  : "Empty"
                : "-"
            }
          />
        </div>

        {accountAddress && !manager ? (
          <Button
            disabled={isCreating || isLoading}
            onClick={onCreate}
            type="button"
          >
            {isCreating ? "Creating..." : "Create manager"}
          </Button>
        ) : null}
      </div>

      {manager ? (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Owner {truncateAddress(manager.owner)}</span>
          <span>Created {formatDate(manager.createdAtMs)}</span>
        </div>
      ) : null}

      {txDigest && !manager ? (
        <div className="mt-3 text-sm text-muted-foreground">
          Manager transaction submitted. Waiting for the indexed server to catch
          up.{" "}
          <a
            className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
            href={getSuiExplorerTxUrl(txDigest)}
            rel="noreferrer"
            target="_blank"
          >
            View transaction
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
      ) : null}

      {error ? <div className="mt-3 text-sm text-destructive">{error}</div> : null}
    </Panel>
  );
}

function LegendItem({
  children,
  color,
  dashed,
  label,
}: {
  children: React.ReactNode;
  color: string;
  dashed?: boolean;
  label: string;
}) {
  return (
    <div className="flex max-w-48 items-start gap-2">
      <span
        className={`mt-1.5 h-0.5 w-4 shrink-0 rounded-full ${
          dashed ? "bg-[repeating-linear-gradient(to_right,currentColor_0_4px,transparent_4px_7px)]" : ""
        }`}
        style={dashed ? { color } : { backgroundColor: color }}
      />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="ml-1 text-muted-foreground">{children}</span>
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}

function Parameter({
  hint,
  label,
  value,
}: {
  hint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-muted px-3 py-2">
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-foreground">{label}</span>
        <Hint>{hint}</Hint>
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 font-medium text-secondary-foreground">
      {children}
    </span>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="h-10 px-3 text-right align-middle font-medium whitespace-nowrap text-muted-foreground first:text-left">
      {children}
    </th>
  );
}

function Td({
  children,
  strong,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`p-3 text-right align-middle font-mono whitespace-nowrap first:text-left ${
        strong ? "font-semibold" : ""
      }`}
    >
      {children}
    </td>
  );
}

function selectDecisionRows(curve: Array<SviPoint>) {
  if (curve.length <= 17) {
    return curve;
  }

  const step = Math.max(1, Math.floor(curve.length / 16));
  return curve.filter((_, index) => index % step === 0).slice(0, 17);
}

function buildPreviewStrikeRows(state: OracleStateResponse) {
  const spot = state.latest_price?.spot;
  const tickSize = state.oracle.tick_size;

  if (!spot || tickSize <= 0) {
    return [];
  }

  const roundedSpotUsd =
    Math.floor(spot / tickSize / PREVIEW_STRIKE_ROUNDING_USD + 0.5) *
    PREVIEW_STRIKE_ROUNDING_USD;
  const roundedSpotStrike = roundedSpotUsd * tickSize;
  const rows: Array<PreviewStrikeRow> = [];
  const seenStrikes = new Set<number>();

  for (
    let offset = -PREVIEW_STRIKE_STEPS_EACH_SIDE;
    offset <= PREVIEW_STRIKE_STEPS_EACH_SIDE;
    offset += 1
  ) {
    if (offset === 0) {
      continue;
    }

    const strike = Math.max(
      state.oracle.min_strike,
      (roundedSpotUsd + offset * PREVIEW_STRIKE_STEP_USD) * tickSize,
    );

    if (strike === roundedSpotStrike) {
      continue;
    }

    if (!seenStrikes.has(strike)) {
      rows.push({ strike });
      seenStrikes.add(strike);
    }
  }

  return rows;
}

function nearestPreviewStrike(
  rows: Array<PreviewStrikeRow>,
  spot: number | null | undefined,
) {
  if (rows.length === 0) {
    return null;
  }

  if (!spot) {
    return rows[0].strike;
  }

  return rows.reduce((nearest, row) =>
    Math.abs(row.strike - spot) < Math.abs(nearest.strike - spot) ? row : nearest,
  ).strike;
}

function nearestStrike(curve: Array<SviPoint>, strike: number) {
  let nearest = curve[0]?.strike ?? strike;
  let nearestDistance = Number.POSITIVE_INFINITY;

  curve.forEach((point) => {
    const distance = Math.abs(point.strike - strike);
    if (distance < nearestDistance) {
      nearest = point.strike;
      nearestDistance = distance;
    }
  });

  return nearest;
}

function scaled(value: number) {
  return (value / FLOAT_SCALING).toFixed(9);
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatProbability(value: number | null) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return percent(value / FLOAT_SCALING);
}

function formatTradeAmount(value: bigint | undefined, isLoading: boolean) {
  if (value !== undefined) {
    return `${formatTokenAmount(value, DEEPBOOK_PREDICT.quote.decimals)} ${DEEPBOOK_PREDICT.quote.symbol}`;
  }

  return isLoading ? "Loading..." : "-";
}

function formatManagerQuote(value: bigint) {
  return `${formatTokenAmount(value, DEEPBOOK_PREDICT.quote.decimals)} ${DEEPBOOK_PREDICT.quote.symbol}`;
}

function getManagerStatus({
  accountAddress,
  error,
  isLoading,
  manager,
  txDigest,
}: {
  accountAddress: string | undefined;
  error: string | null;
  isLoading: boolean;
  manager: PredictManagerSummary | null;
  txDigest: string | null;
}) {
  if (!accountAddress) {
    return "Wallet needed";
  }

  if (isLoading) {
    return "Loading";
  }

  if (manager) {
    return "Ready";
  }

  if (txDigest) {
    return "Indexing";
  }

  if (error) {
    return "Error";
  }

  return "Not created";
}

function getFundingPlan(
  manager: PredictManagerSummary | null,
  walletBalances: WalletVaultBalances | null,
  mintCost: bigint | undefined,
) {
  const managerBalance = manager?.quoteBalance ?? 0n;
  const walletBalance = walletBalances?.quote ?? 0n;
  const cost = mintCost ?? 0n;
  const requiredWalletDeposit =
    cost > managerBalance ? cost - managerBalance : 0n;
  const walletDeficit =
    requiredWalletDeposit > walletBalance
      ? requiredWalletDeposit - walletBalance
      : 0n;
  const managerBalanceAfterMint =
    managerBalance + requiredWalletDeposit > cost
      ? managerBalance + requiredWalletDeposit - cost
      : 0n;

  return {
    managerBalanceAfterMint,
    requiredWalletDeposit,
    walletDeficit,
  };
}

function scaleTradeAmounts(
  amounts: OracleTradeAmounts,
  quantity: bigint,
): OracleTradeAmounts {
  return {
    mintCost: scaleTradeAmount(amounts.mintCost, quantity),
    redeemPayout: scaleTradeAmount(amounts.redeemPayout, quantity),
  };
}

function scaleTradeAmount(amount: bigint, quantity: bigint) {
  return amount * quantity;
}

function getScaledAskPrice(mintCost: bigint, quantity: bigint) {
  return (mintCost * BigInt(FLOAT_SCALING)) / quantity;
}

function formatQuantityInput(value: number) {
  return Math.trunc(value).toString();
}

function parseContractQuantity(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0n;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Enter a whole-number quantity");
  }

  return BigInt(trimmed);
}

function isTradePreviewRenderable(state: OracleStateResponse) {
  return Boolean(
    state.oracle.status === "active" && state.latest_price && state.latest_svi,
  );
}

function isAbortError(caughtError: unknown) {
  return caughtError instanceof Error && caughtError.name === "AbortError";
}

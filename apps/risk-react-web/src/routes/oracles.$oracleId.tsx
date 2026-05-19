import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Minus, Plus, RefreshCw } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
  createManagerTransaction,
  decodeSignedScaled,
  findLastTradeAsk,
  getSuiExplorerTxUrl,
  getWalletPredictManager,
  getOracleState,
  getOracleTradeAmounts,
  getOracleTrades,
  type OracleTradeAmounts,
  type PredictManagerSummary,
  type OracleStateResponse,
  type OracleTrade,
  type SviPoint,
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
const TRADE_PREVIEW_UNIT_QUANTITY = 1_000_000n;

function OraclePage() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction, isPending: isTxPending } =
    useSignAndExecuteTransaction();
  const { oracleId } = Route.useParams();
  const [state, setState] = useState<OracleStateResponse | null>(null);
  const [trades, setTrades] = useState<Array<OracleTrade>>([]);
  const [manager, setManager] = useState<PredictManagerSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isManagerLoading, setIsManagerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerTxDigest, setManagerTxDigest] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [previewIsUp, setPreviewIsUp] = useState(true);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [tradeAmounts, setTradeAmounts] = useState<OracleTradeAmounts | null>(
    null,
  );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadOracle(showLoading: boolean) {
      if (showLoading) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const [oracleState, oracleTrades] = await Promise.all([
          getOracleState(oracleId),
          getOracleTrades(oracleId),
        ]);

        if (!abortController.signal.aborted) {
          setState(oracleState);
          setTrades(oracleTrades);
          setError(null);
        }
      } catch (caughtError) {
        if (!abortController.signal.aborted && showLoading) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Failed to load oracle",
          );
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadOracle(true);
    const intervalId = window.setInterval(() => {
      void loadOracle(false);
    }, ORACLE_REFRESH_INTERVAL_MS);

    return () => {
      abortController.abort();
      window.clearInterval(intervalId);
    };
  }, [oracleId]);

  const curve = useMemo(() => (state ? buildSviCurve(state) : []), [state]);
  const tableRows = useMemo(() => selectDecisionRows(curve), [curve]);
  const previewStrikeRows = tableRows;
  const showTradePreview = Boolean(
    state && isTradePreviewRenderable(state) && previewStrikeRows.length > 0,
  );
  const parsedQuantity = useMemo(() => {
    try {
      return parseContractQuantity(quantity);
    } catch {
      return null;
    }
  }, [quantity]);

  async function loadManager() {
    if (!account) {
      setManager(null);
      setManagerError(null);
      setIsManagerLoading(false);
      return;
    }

    setIsManagerLoading(true);
    setManagerError(null);

    try {
      const nextManager = await getWalletPredictManager(client, account.address);
      setManager(nextManager);

      if (nextManager) {
        setManagerTxDigest(null);
      }
    } catch (caughtError) {
      setManagerError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to load PredictManager",
      );
    } finally {
      setIsManagerLoading(false);
    }
  }

  useEffect(() => {
    void loadManager();
  }, [account?.address, client]);

  useEffect(() => {
    if (!account || manager || !managerTxDigest) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadManager();
    }, MANAGER_INDEX_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [account, manager, managerTxDigest]);

  useEffect(() => {
    if (!showTradePreview) {
      setSelectedStrike(null);
      return;
    }

    if (
      selectedStrike === null ||
      !previewStrikeRows.some((row) => row.strike === selectedStrike)
    ) {
      setSelectedStrike(
        nearestPreviewStrike(previewStrikeRows, state?.latest_price?.spot),
      );
    }
  }, [previewStrikeRows, selectedStrike, showTradePreview, state?.latest_price?.spot]);

  useEffect(() => {
    if (
      !state ||
      !showTradePreview ||
      selectedStrike === null ||
      parsedQuantity === null ||
      parsedQuantity === 0n
    ) {
      setTradeAmounts(null);
      setPreviewError(null);
      setIsPreviewLoading(false);
      return;
    }

    const abortController = new AbortController();
    setIsPreviewLoading(true);
    setPreviewError(null);

    const timeoutId = window.setTimeout(() => {
      getOracleTradeAmounts(client, {
        expiry: state.oracle.expiry,
        isUp: previewIsUp,
        oracleId: state.oracle.oracle_id,
        quantity: TRADE_PREVIEW_UNIT_QUANTITY,
        strike: selectedStrike,
      })
        .then((amounts) => {
          if (!abortController.signal.aborted) {
            setTradeAmounts(scaleTradeAmounts(amounts, parsedQuantity));
          }
        })
        .catch((caughtError) => {
          if (!abortController.signal.aborted) {
            setTradeAmounts(null);
            setPreviewError(
              caughtError instanceof Error
                ? caughtError.message
                : "Failed to load trade preview",
            );
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setIsPreviewLoading(false);
          }
        });
    }, TRADE_PREVIEW_DEBOUNCE_MS);

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    client,
    parsedQuantity,
    previewIsUp,
    selectedStrike,
    showTradePreview,
    state,
  ]);

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

  const { oracle, latest_price: price, latest_svi: svi, ask_bounds: askBounds } =
    state;
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

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm text-muted-foreground">
              {oracle.underlying_asset} oracle
            </div>
            <h1 className="mt-1 text-2xl font-semibold">
              {truncateAddress(oracle.oracle_id)}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge>{oracle.status}</Badge>
              <Badge>expiry {formatDate(oracle.expiry)}</Badge>
              {isSettled && oracle.settlement_price !== null ? (
                <Badge>
                  settled{" "}
                  {formatTickValue(oracle.settlement_price, oracle.tick_size)}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Metric label="Spot" value={formatTickValue(spot, oracle.tick_size)} />
            <Metric
              label="Forward"
              value={formatTickValue(forward, oracle.tick_size)}
            />
            <Metric
              label="Tick"
              value={formatTickValue(oracle.tick_size, oracle.tick_size)}
            />
            <Metric
              label="Min strike"
              value={formatTickValue(oracle.min_strike, oracle.tick_size)}
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

              <div className="grid gap-3 sm:grid-cols-2">
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
              </div>

              {parsedQuantity === null || parsedQuantity === 0n ? (
                <div className="text-sm text-destructive">Enter a quantity.</div>
              ) : previewError ? (
                <div className="text-sm text-destructive">{previewError}</div>
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
            </div>
          </Panel>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
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
                <LegendItem
                  color="var(--muted-foreground)"
                  dashed
                  label="Forward"
                >
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
                  tickFormatter={(value) =>
                    formatTickValue(Number(value), oracle.tick_size)
                  }
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
                  stroke="var(--color-upFair)"
                  strokeWidth={2}
                  type="monotone"
                />
                <Line
                  dataKey="dnFair"
                  dot={false}
                  stroke="var(--color-dnFair)"
                  strokeWidth={2}
                  type="monotone"
                />
              </LineChart>
            </ChartContainer>
          </Panel>

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

        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="SVI Smile">
            <ChartContainer config={chartConfig} className="h-72 w-full">
              <LineChart data={curve} margin={{ left: 8, right: 16, top: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="strike"
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(value) =>
                    formatTickValue(Number(value), oracle.tick_size)
                  }
                />
                <YAxis tickFormatter={(value) => Number(value).toExponential(1)} />
                <Tooltip
                  content={
                    <ChartTooltipContent
                      valueFormatter={(value) => Number(value).toExponential(4)}
                    />
                  }
                />
                <Line
                  dataKey="totalVariance"
                  dot={false}
                  stroke="var(--color-totalVariance)"
                  strokeWidth={2}
                  type="monotone"
                />
              </LineChart>
            </ChartContainer>
          </Panel>

          <Panel title="Decision Inputs">
            <div className="grid gap-3 text-sm">
              <InfoRow label="Ask bounds">
                {askBounds
                  ? `${formatProbability(askBounds.min_ask_price)} - ${formatProbability(
                      askBounds.max_ask_price,
                    )}`
                  : "Inherited global bounds"}
              </InfoRow>
              <InfoRow label="Protocol ask source">
                Last observed trade ask when available
              </InfoRow>
              <InfoRow label="Edge model">fair probability - ask</InfoRow>
              <InfoRow label="Range fair value">UP lower - UP higher</InfoRow>
              <InfoRow label="Trade scope">Read-only decision support</InfoRow>
            </div>
          </Panel>
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
                  <Th>Last UP ask</Th>
                  <Th>UP edge</Th>
                  <Th>Last DN ask</Th>
                  <Th>DN edge</Th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => {
                  const upAsk = findLastTradeAsk(trades, row.strike, true);
                  const dnAsk = findLastTradeAsk(trades, row.strike, false);

                  return (
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
                      <Td>{formatProbability(upAsk)}</Td>
                      <Td>{formatEdge(row.upFair, upAsk)}</Td>
                      <Td>{formatProbability(dnAsk)}</Td>
                      <Td>{formatEdge(row.dnFair, dnAsk)}</Td>
                    </tr>
                  );
                })}
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

function nearestPreviewStrike(rows: Array<SviPoint>, spot: number | null | undefined) {
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

function formatEdge(fair: number, ask: number | null) {
  if (ask === null || ask === undefined) {
    return "n/a";
  }

  return `${((fair - ask / FLOAT_SCALING) * 100).toFixed(2)} pts`;
}

function formatTradeAmount(value: bigint | undefined, isLoading: boolean) {
  if (isLoading) {
    return "Loading...";
  }

  if (value === undefined) {
    return "-";
  }

  return `${formatTokenAmount(value, DEEPBOOK_PREDICT.quote.decimals)} ${DEEPBOOK_PREDICT.quote.symbol}`;
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

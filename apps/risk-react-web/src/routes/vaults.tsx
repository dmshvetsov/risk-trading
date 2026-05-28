import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEEPBOOK_PREDICT,
  type VaultSummary,
  type WalletVaultBalances,
  createSupplyTransaction,
  createWithdrawTransaction,
  getSuiExplorerTxUrl,
  getVaultSummary,
  getWalletVaultBalances,
  parseTokenAmount,
} from "@/lib/deepbook-predict";
import { formatDate, formatTokenAmount, truncateAddress } from "@/lib/format";

type VaultMode = "supply" | "withdraw";
type LpFlowScaleMode = "log" | "linear";

const LP_SUPPLIES_URL = "https://predict-server.testnet.mystenlabs.com/lp/supplies";
const LP_WITHDRAWALS_URL =
  "https://predict-server.testnet.mystenlabs.com/lp/withdrawals";
const LP_FLOW_BUCKET_COUNT = 14;
const LP_ACTIVITY_ROW_LIMIT = 25;
const LP_FLOW_OUTLIER_RATIO = 1_000;
const QUOTE_AMOUNT_SCALE = 10 ** DEEPBOOK_PREDICT.quote.decimals;

const lpFlowChartConfig = {
  supplyDisplay: {
    color: "var(--chart-2)",
    label: "Supplied",
  },
  withdrawalDisplay: {
    color: "var(--chart-5)",
    label: "Withdrawn",
  },
} satisfies ChartConfig;

type LpSupply = {
  amount: number;
  checkpoint: number;
  checkpoint_timestamp_ms: number;
  digest: string;
  event_digest: string;
  event_index: number;
  sender: string;
  shares_minted: number;
  supplier: string;
};

type LpWithdrawal = {
  amount: number;
  checkpoint: number;
  checkpoint_timestamp_ms: number;
  digest: string;
  event_digest: string;
  event_index: number;
  sender: string;
  shares_burned: number;
  withdrawer: string;
};

type LpActivity = {
  activity: "Supply" | "Withdrawal";
  amount: number;
  checkpoint: number;
  checkpoint_timestamp_ms: number;
  event_digest: string;
  event_index: number;
  sender: string;
  shares: number;
  wallet: string;
};

type LpFlowBucket = {
  date: string;
  label: string;
  supply: number;
  withdrawal: number;
};

type LpFlowChartBucket = LpFlowBucket & {
  supplyDisplay: number;
  withdrawalDisplay: number;
  supplyOutlierLabel: string;
  withdrawalOutlierLabel: string;
};

export const Route = createFileRoute("/vaults")({
  component: Vaults,
});

function Vaults() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction, isPending } =
    useSignAndExecuteTransaction();
  const [mode, setMode] = useState<VaultMode>("supply");
  const [amount, setAmount] = useState("");
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const [balances, setBalances] = useState<WalletVaultBalances | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActivityLoading, setIsActivityLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [txDigest, setTxDigest] = useState<string | null>(null);
  const [supplies, setSupplies] = useState<Array<LpSupply>>([]);
  const [withdrawals, setWithdrawals] = useState<Array<LpWithdrawal>>([]);
  const [lpFlowScaleMode, setLpFlowScaleMode] =
    useState<LpFlowScaleMode>("log");
  const inputDecimals =
    mode === "supply"
      ? DEEPBOOK_PREDICT.quote.decimals
      : DEEPBOOK_PREDICT.plp.decimals;
  const outputDecimals =
    mode === "supply"
      ? DEEPBOOK_PREDICT.plp.decimals
      : DEEPBOOK_PREDICT.quote.decimals;

  const parsedAmount = useMemo(() => {
    try {
      return parseTokenAmount(amount, inputDecimals);
    } catch {
      return null;
    }
  }, [amount, inputDecimals]);

  const estimatedOutput = useMemo(() => {
    if (!summary || parsedAmount === null || parsedAmount === 0n) {
      return 0n;
    }

    if (mode === "supply") {
      if (summary.totalPlpSupply === 0n || summary.vaultValue <= 0n) {
        return parsedAmount;
      }

      return (parsedAmount * summary.totalPlpSupply) / summary.vaultValue;
    }

    if (summary.totalPlpSupply === 0n) {
      return 0n;
    }

    return (parsedAmount * summary.vaultValue) / summary.totalPlpSupply;
  }, [mode, parsedAmount, summary]);

  const validationError = useMemo(() => {
    try {
      const value = parseTokenAmount(amount, inputDecimals);
      if (value === 0n) {
        return "Enter an amount";
      }

      if (!account) {
        return "Connect a wallet";
      }

      if (!balances || !summary) {
        return "Loading vault data";
      }

      if (mode === "supply" && value > balances.quote) {
        return `Insufficient ${DEEPBOOK_PREDICT.quote.symbol}`;
      }

      if (mode === "withdraw" && value > balances.plp) {
        return `Insufficient ${DEEPBOOK_PREDICT.plp.symbol}`;
      }

      if (mode === "withdraw" && estimatedOutput > summary.availableWithdrawal) {
        return "Requested withdrawal exceeds available liquidity";
      }

      return null;
    } catch (caughtError) {
      return caughtError instanceof Error
        ? caughtError.message
        : "Enter a valid amount";
    }
  }, [account, amount, balances, estimatedOutput, inputDecimals, mode, summary]);

  async function loadVaultData() {
    setIsLoading(true);
    setError(null);

    try {
      const nextSummary = await getVaultSummary(client, account?.address);
      setSummary(nextSummary);

      if (account) {
        setBalances(await getWalletVaultBalances(client, account.address));
      } else {
        setBalances(null);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to load vault data",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadVaultData();
  }, [account?.address, client]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadLpActivity() {
      setIsActivityLoading(true);
      setActivityError(null);

      try {
        const [suppliesResponse, withdrawalsResponse] = await Promise.all([
          fetch(LP_SUPPLIES_URL, { signal: abortController.signal }),
          fetch(LP_WITHDRAWALS_URL, { signal: abortController.signal }),
        ]);

        if (!suppliesResponse.ok) {
          throw new Error(`Supplies request failed with ${suppliesResponse.status}`);
        }

        if (!withdrawalsResponse.ok) {
          throw new Error(
            `Withdrawals request failed with ${withdrawalsResponse.status}`,
          );
        }

        const [suppliesData, withdrawalsData] = (await Promise.all([
          suppliesResponse.json(),
          withdrawalsResponse.json(),
        ])) as [Array<LpSupply>, Array<LpWithdrawal>];

        setSupplies(suppliesData);
        setWithdrawals(withdrawalsData);
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return;
        }

        setActivityError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load liquidity flow activity",
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsActivityLoading(false);
        }
      }
    }

    void loadLpActivity();

    return () => abortController.abort();
  }, []);

  const lpFlowBuckets = useMemo(
    () => buildLpFlowBuckets(supplies, withdrawals),
    [supplies, withdrawals],
  );
  const lpFlowLogThreshold = useMemo(
    () => getLpFlowLogThreshold(lpFlowBuckets),
    [lpFlowBuckets],
  );
  const lpFlowChartBuckets = useMemo(
    () =>
      buildLpFlowChartBuckets(
        lpFlowBuckets,
        lpFlowScaleMode,
        lpFlowLogThreshold,
      ),
    [lpFlowBuckets, lpFlowLogThreshold, lpFlowScaleMode],
  );
  const recentActivity = useMemo(
    () =>
      [
        ...supplies.map(
          (supply): LpActivity => ({
            activity: "Supply",
            amount: supply.amount,
            checkpoint: supply.checkpoint,
            checkpoint_timestamp_ms: supply.checkpoint_timestamp_ms,
            event_digest: supply.event_digest,
            event_index: supply.event_index,
            sender: supply.sender,
            shares: supply.shares_minted,
            wallet: supply.supplier,
          }),
        ),
        ...withdrawals.map(
          (withdrawal): LpActivity => ({
            activity: "Withdrawal",
            amount: withdrawal.amount,
            checkpoint: withdrawal.checkpoint,
            checkpoint_timestamp_ms: withdrawal.checkpoint_timestamp_ms,
            event_digest: withdrawal.event_digest,
            event_index: withdrawal.event_index,
            sender: withdrawal.sender,
            shares: withdrawal.shares_burned,
            wallet: withdrawal.withdrawer,
          }),
        ),
      ]
        .sort((a, b) => b.checkpoint - a.checkpoint)
        .slice(0, LP_ACTIVITY_ROW_LIMIT),
    [supplies, withdrawals],
  );

  async function submitLiquidityAction() {
    if (!account || parsedAmount === null || validationError) {
      return;
    }

    setError(null);
    setTxDigest(null);

    try {
      const transaction =
        mode === "supply"
          ? createSupplyTransaction(parsedAmount, account.address)
          : createWithdrawTransaction(parsedAmount, account.address);

      const result = await signAndExecuteTransaction({
        transaction,
        chain: "sui:testnet",
      });

      setTxDigest(result.digest);
      setAmount("");
      await loadVaultData();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Transaction failed",
      );
    }
  }

  const inputSymbol =
    mode === "supply" ? DEEPBOOK_PREDICT.quote.symbol : DEEPBOOK_PREDICT.plp.symbol;
  const outputSymbol =
    mode === "supply" ? DEEPBOOK_PREDICT.plp.symbol : DEEPBOOK_PREDICT.quote.symbol;
  const maxAmount =
    mode === "supply" ? balances?.quote ?? 0n : balances?.plp ?? 0n;
  const walletShare =
    summary && summary.totalPlpSupply > 0n
      ? Number(balances?.plp ?? 0n) / Number(summary.totalPlpSupply)
      : 0;

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold">
            Supply {DEEPBOOK_PREDICT.quote.symbol} liquidity or withdraw by
            burning {DEEPBOOK_PREDICT.plp.symbol} shares.
          </h1>
          <p className="text-sm text-muted-foreground">
            Accepted quote asset:{" "}
            <span className="font-mono text-foreground break-all">
              {DEEPBOOK_PREDICT.quote.type}
            </span>
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Vault balance" value={summary ? formatQuoteAmount(summary.totalBalance) : "-"} />
          <Metric label="Vault value" value={summary ? formatQuoteAmount(summary.vaultValue) : "-"} />
          <Metric label="Available withdrawal" value={summary ? formatQuoteAmount(summary.availableWithdrawal) : "-"} />
          <Metric label="PLP supply" value={summary ? formatPlpAmount(summary.totalPlpSupply) : "-"} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_1fr]">
          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <Tabs value={mode} onValueChange={(value) => setMode(value as VaultMode)}>
                <TabsList aria-label="Vault action">
                  <TabsTrigger value="supply">Supply</TabsTrigger>
                  <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                </TabsList>
              </Tabs>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
                onClick={() => void loadVaultData()}
                type="button"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Refresh
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="vault-amount">
                Amount
              </label>
              <div className="flex overflow-hidden rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-lg outline-none"
                  id="vault-amount"
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.0"
                  value={amount}
                />
                <div className="flex items-center gap-2 border-l border-border px-3 text-sm font-medium">
                  {inputSymbol}
                </div>
              </div>
              <button
                className="self-start text-xs text-muted-foreground hover:text-foreground"
                disabled={!balances}
                onClick={() => setAmount(formatInputAmount(maxAmount, inputDecimals))}
                type="button"
              >
                Balance {formatInputAmount(maxAmount, inputDecimals)} {inputSymbol}
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Estimated output</span>
                <span className="font-mono">
                  {formatInputAmount(estimatedOutput, outputDecimals)} {outputSymbol}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Connected wallet</span>
                <span className="font-mono">
                  {account ? truncateAddress(account.address) : "Not connected"}
                </span>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {txDigest ? (
              <a
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                href={getSuiExplorerTxUrl(txDigest)}
                rel="noreferrer"
                target="_blank"
              >
                View transaction <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            ) : null}

            <button
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isPending || Boolean(validationError)}
              onClick={() => void submitLiquidityAction()}
              type="button"
            >
              {mode === "supply" ? (
                <ArrowDownToLine className="size-4" aria-hidden="true" />
              ) : (
                <ArrowUpFromLine className="size-4" aria-hidden="true" />
              )}
              {isPending ? "Waiting for wallet" : validationError ?? (mode === "supply" ? "Supply Liquidity" : "Withdraw Liquidity")}
            </button>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="text-base font-semibold">Position In Vault</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label={`${DEEPBOOK_PREDICT.quote.symbol} balance`} value={`${formatQuoteAmount(balances?.quote ?? 0n)} ${DEEPBOOK_PREDICT.quote.symbol}`} />
              <Metric label={`${DEEPBOOK_PREDICT.plp.symbol} balance`} value={`${formatPlpAmount(balances?.plp ?? 0n)} ${DEEPBOOK_PREDICT.plp.symbol}`} />
              <Metric label="Wallet LP share" value={formatPercent(walletShare)} />
              <Metric label="Max payout coverage" value={summary ? formatQuoteAmount(summary.totalMaxPayout) : "-"} />
              <Metric label="Mark-to-market liability" value={summary ? formatQuoteAmount(summary.totalMtm) : "-"} />
            </div>
            {isLoading ? (
              <div className="mt-4 text-sm text-muted-foreground">Loading vault data...</div>
            ) : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm lg:col-span-2">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">LP Flow</h2>
                <p className="text-sm text-muted-foreground">
                  Daily {DEEPBOOK_PREDICT.quote.symbol} supplies and withdrawals.
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <LegendItem color="var(--chart-2)" label="Supplied" />
                <LegendItem color="var(--chart-5)" label="Withdrawn" />
                <Tabs
                  value={lpFlowScaleMode}
                  onValueChange={(value) =>
                    setLpFlowScaleMode(value as LpFlowScaleMode)
                  }
                >
                  <TabsList aria-label="LP flow scale" className="h-8">
                    <TabsTrigger value="log" className="px-2 text-xs">
                      Log
                    </TabsTrigger>
                    <TabsTrigger value="linear" className="px-2 text-xs">
                      Linear
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            <div className="mt-4">
              {isActivityLoading ? (
                <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                  Loading liquidity flow...
                </div>
              ) : activityError ? (
                <div className="flex h-72 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 px-4 text-center text-sm text-destructive">
                  {activityError}
                </div>
              ) : lpFlowBuckets.length === 0 ? (
                <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                  No LP flow activity found.
                </div>
              ) : (
                <ChartContainer config={lpFlowChartConfig} className="h-72 w-full">
                  <BarChart
                    accessibilityLayer
                    data={lpFlowChartBuckets}
                    margin={{ left: 8, right: 16, top: 12 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={16}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) =>
                        compactTokenAmount(
                          lpFlowScaleMode === "log"
                            ? inverseSymmetricLog(
                                Number(value),
                                lpFlowLogThreshold,
                              )
                            : Number(value),
                        )
                      }
                    />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Tooltip
                      cursor={{ fill: "var(--muted)" }}
                      content={
                        <ChartTooltipContent
                          valueFormatter={(_value, name, item) => {
                            const rawValue = getRawLpFlowValue(
                              name,
                              item.payload as LpFlowChartBucket | undefined,
                            );

                            return `${compactTokenAmount(Math.abs(rawValue))} ${DEEPBOOK_PREDICT.quote.symbol}`;
                          }}
                        />
                      }
                    />
                    <Bar
                      dataKey="supplyDisplay"
                      fill="var(--color-supplyDisplay)"
                      radius={[4, 4, 0, 0]}
                    >
                      <LabelList
                        dataKey="supplyOutlierLabel"
                        position="top"
                        className="fill-muted-foreground text-[10px]"
                      />
                    </Bar>
                    <Bar
                      dataKey="withdrawalDisplay"
                      fill="var(--color-withdrawalDisplay)"
                      radius={[4, 4, 0, 0]}
                    >
                      <LabelList
                        dataKey="withdrawalOutlierLabel"
                        position="bottom"
                        className="fill-muted-foreground text-[10px]"
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm lg:col-span-2">
            <div className="border-b border-border p-4">
              <h2 className="text-base font-semibold">Vault Activity</h2>
              <p className="text-sm text-muted-foreground">
                Most recent {LP_ACTIVITY_ROW_LIMIT} supply and withdrawal events.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b border-border transition-colors hover:bg-muted/50">
                    <TableHead>Activity</TableHead>
                    <TableHead align="right">
                      Amount ({DEEPBOOK_PREDICT.quote.symbol})
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead align="right">Shares</TableHead>
                    <TableHead>Wallet</TableHead>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {isActivityLoading ? (
                    <tr className="border-b border-border">
                      <td
                        className="p-6 text-center text-muted-foreground"
                        colSpan={6}
                      >
                        Loading liquidity pool activity...
                      </td>
                    </tr>
                  ) : activityError ? (
                    <tr className="border-b border-border">
                      <td className="p-6 text-center text-destructive" colSpan={6}>
                        {activityError}
                      </td>
                    </tr>
                  ) : recentActivity.length === 0 ? (
                    <tr className="border-b border-border">
                      <td
                        className="p-6 text-center text-muted-foreground"
                        colSpan={6}
                      >
                        No liquidity pool activity found.
                      </td>
                    </tr>
                  ) : (
                    recentActivity.map((item) => (
                      <LpActivityRow
                        activity={item}
                        key={`${item.event_digest}-${item.event_index}`}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function LpActivityRow({ activity }: { activity: LpActivity }) {
  return (
    <tr className="border-b border-border transition-colors hover:bg-muted/50">
      <TableCell>
        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
          {activity.activity}
        </span>
      </TableCell>
      <TableCell align="right" mono>
        {formatTokenAmount(activity.amount, DEEPBOOK_PREDICT.quote.decimals)}
      </TableCell>
      <TableCell>{formatDate(activity.checkpoint_timestamp_ms)}</TableCell>
      <TableCell mono>{truncateAddress(activity.sender)}</TableCell>
      <TableCell align="right" mono>
        {activity.shares.toLocaleString()}
      </TableCell>
      <TableCell mono>{truncateAddress(activity.wallet)}</TableCell>
    </tr>
  );
}

function TableHead({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th
      className={`h-10 px-3 align-middle font-medium whitespace-nowrap text-muted-foreground ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function TableCell({
  align = "left",
  children,
  mono = false,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`p-3 align-middle whitespace-nowrap ${
        align === "right" ? "text-right" : ""
      } ${mono ? "font-mono" : ""}`}
    >
      {children}
    </td>
  );
}

function buildLpFlowBuckets(
  supplies: Array<LpSupply>,
  withdrawals: Array<LpWithdrawal>,
): Array<LpFlowBucket> {
  const events = [
    ...supplies.map((supply) => ({
      amount: supply.amount,
      timestamp: supply.checkpoint_timestamp_ms,
      type: "supply" as const,
    })),
    ...withdrawals.map((withdrawal) => ({
      amount: withdrawal.amount,
      timestamp: withdrawal.checkpoint_timestamp_ms,
      type: "withdrawal" as const,
    })),
  ];
  const buckets = new Map<string, LpFlowBucket>();

  for (const event of events) {
    const date = new Date(event.timestamp);
    const key = getLocalDateKey(date);
    const bucket =
      buckets.get(key) ??
      ({
        date: key,
        label: formatLpFlowDateLabel(date),
        supply: 0,
        withdrawal: 0,
      } satisfies LpFlowBucket);

    const tokenAmount = event.amount / QUOTE_AMOUNT_SCALE;
    bucket[event.type] += event.type === "withdrawal" ? -tokenAmount : tokenAmount;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-LP_FLOW_BUCKET_COUNT);
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLpFlowDateLabel(date: Date) {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function buildLpFlowChartBuckets(
  buckets: Array<LpFlowBucket>,
  scaleMode: LpFlowScaleMode,
  logThreshold: number,
): Array<LpFlowChartBucket> {
  const outlierFloor = getLpFlowOutlierFloor(buckets);

  return buckets.map((bucket) => ({
    ...bucket,
    supplyDisplay:
      scaleMode === "log"
        ? symmetricLog(bucket.supply, logThreshold)
        : bucket.supply,
    withdrawalDisplay:
      scaleMode === "log"
        ? symmetricLog(bucket.withdrawal, logThreshold)
        : bucket.withdrawal,
    supplyOutlierLabel: Math.abs(bucket.supply) >= outlierFloor ? "!" : "",
    withdrawalOutlierLabel:
      Math.abs(bucket.withdrawal) >= outlierFloor ? "!" : "",
  }));
}

function getLpFlowLogThreshold(buckets: Array<LpFlowBucket>) {
  const nonZeroValues = buckets
    .flatMap((bucket) => [Math.abs(bucket.supply), Math.abs(bucket.withdrawal)])
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  if (nonZeroValues.length === 0) {
    return 1;
  }

  const median = nonZeroValues[Math.floor(nonZeroValues.length / 2)];
  return Math.max(median / 10, Number.EPSILON);
}

function getLpFlowOutlierFloor(buckets: Array<LpFlowBucket>) {
  const nonZeroValues = buckets
    .flatMap((bucket) => [Math.abs(bucket.supply), Math.abs(bucket.withdrawal)])
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  if (nonZeroValues.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const median = nonZeroValues[Math.floor(nonZeroValues.length / 2)];
  return Math.max(median * LP_FLOW_OUTLIER_RATIO, Number.EPSILON);
}

function symmetricLog(value: number, threshold: number) {
  return Math.sign(value) * Math.log10(1 + Math.abs(value) / threshold);
}

function inverseSymmetricLog(value: number, threshold: number) {
  return Math.sign(value) * threshold * (10 ** Math.abs(value) - 1);
}

function getRawLpFlowValue(
  name: string,
  bucket: LpFlowChartBucket | undefined,
) {
  if (!bucket) {
    return 0;
  }

  return name === "withdrawalDisplay" ? bucket.withdrawal : bucket.supply;
}

function compactTokenAmount(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(value) >= 10 ? 0 : 2,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
  }).format(value);
}

function formatQuoteAmount(value: bigint | number) {
  return formatTokenAmount(value, DEEPBOOK_PREDICT.quote.decimals);
}

function formatPlpAmount(value: bigint | number) {
  return formatTokenAmount(value, DEEPBOOK_PREDICT.plp.decimals);
}

function formatInputAmount(value: bigint | number, decimals: number) {
  return formatTokenAmount(value, decimals);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    minimumFractionDigits: value > 0 && value < 0.01 ? 2 : 0,
    style: "percent",
  }).format(value);
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

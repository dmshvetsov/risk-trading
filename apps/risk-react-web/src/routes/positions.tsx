import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, RefreshCw } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEEPBOOK_PREDICT,
  createRedeemAndWithdrawPositionTransaction,
  getOracleState,
  getOracleTradeAmounts,
  getSuiExplorerTxUrl,
  getWalletPredictManager,
  getWalletPredictPositions,
  parseTokenAmount,
  type OracleStateResponse,
  type PredictManagerSummary,
  type WalletPredictPosition,
} from "@/lib/deepbook-predict";
import {
  formatDate,
  formatTickValue,
  formatTokenAmount,
  truncateAddress,
} from "@/lib/format";

export const Route = createFileRoute("/positions")({
  component: Positions,
});

const REFRESH_INTERVAL_MS = 30_000;
const PREVIEW_REFRESH_INTERVAL_MS = 5_000;

type PortfolioPosition = WalletPredictPosition & {
  oracleState: OracleStateResponse | null;
  payoutError: string | null;
  redeemPayout: bigint | null;
};

function Positions() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction, isPending: isTxPending } =
    useSignAndExecuteTransaction();
  const [manager, setManager] = useState<PredictManagerSummary | null>(null);
  const [positions, setPositions] = useState<Array<PortfolioPosition>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closeQuantity, setCloseQuantity] = useState("");
  const [preview, setPreview] = useState<bigint | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRefreshedAt, setPreviewRefreshedAt] = useState<number | null>(
    null,
  );
  const [previewRefreshTick, setPreviewRefreshTick] = useState(0);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [txDigest, setTxDigest] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const selectedPosition = useMemo(
    () => positions.find((position) => position.id === selectedId) ?? null,
    [positions, selectedId],
  );
  const parsedCloseQuantity = useMemo(() => {
    try {
      return parseTokenAmount(closeQuantity);
    } catch {
      return null;
    }
  }, [closeQuantity]);
  const previewAgeMs =
    previewRefreshedAt === null ? null : Math.max(0, nowMs - previewRefreshedAt);
  const previewRefreshInMs =
    previewAgeMs === null
      ? null
      : Math.max(0, PREVIEW_REFRESH_INTERVAL_MS - previewAgeMs);
  const isPreviewStale = Boolean(
    preview && previewAgeMs !== null && previewAgeMs >= PREVIEW_REFRESH_INTERVAL_MS,
  );
  const closeValidationError = getCloseValidationError({
    isPreviewLoading,
    isPreviewStale,
    parsedCloseQuantity,
    position: selectedPosition,
    preview,
    previewError,
  });

  async function loadPortfolio(showLoading = true) {
    if (!account) {
      setManager(null);
      setPositions([]);
      setError(null);
      setRefreshedAt(null);
      setIsLoading(false);
      return;
    }

    if (showLoading) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const nextManager = await getWalletPredictManager(client, account.address);
      setManager(nextManager);

      if (!nextManager) {
        setPositions([]);
        setRefreshedAt(Date.now());
        return;
      }

      const rawPositions = await getWalletPredictPositions(client, nextManager);
      const oracleStates = await getOracleStatesById(rawPositions.map((p) => p.oracleId));
      const nextPositions = await Promise.all(
        rawPositions.map(async (position): Promise<PortfolioPosition> => {
          const oracleState = oracleStates.get(position.oracleId) ?? null;

          try {
            return {
              ...position,
              oracleState,
              payoutError: null,
              redeemPayout: oracleState
                ? await getEstimatedRedeemPayout(position, oracleState)
                : null,
            };
          } catch (caughtError) {
            return {
              ...position,
              oracleState,
              payoutError:
                caughtError instanceof Error
                  ? caughtError.message
                  : "Preview unavailable",
              redeemPayout: null,
            };
          }
        }),
      );

      setPositions(nextPositions);
      setRefreshedAt(Date.now());
      if (selectedId && !nextPositions.some((position) => position.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to load portfolio",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function getOracleStatesById(oracleIds: Array<string>) {
    const uniqueOracleIds = [...new Set(oracleIds)];
    const entries = await Promise.all(
      uniqueOracleIds.map(async (oracleId) => [oracleId, await getOracleState(oracleId)] as const),
    );

    return new Map(entries);
  }

  async function getEstimatedRedeemPayout(
    position: WalletPredictPosition,
    oracleState: OracleStateResponse,
  ) {
    if (oracleState.oracle.status === "settled") {
      return getSettledPayout(position, oracleState);
    }

    if (!isQuoteable(oracleState)) {
      return null;
    }

    const amounts = await getOracleTradeAmounts(client, {
      expiry: position.expiry,
      isUp: position.isUp,
      oracleId: position.oracleId,
      quantity: position.quantity,
      strike: position.strike,
    });

    return amounts.redeemPayout;
  }

  useEffect(() => {
    void loadPortfolio();
  }, [account?.address, client]);

  useEffect(() => {
    if (!account) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadPortfolio(false);
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [account?.address, client]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!selectedPosition) {
      setCloseQuantity("");
      setPreview(null);
      setPreviewError(null);
      setPreviewRefreshedAt(null);
      return;
    }

    setCloseQuantity(formatTokenInput(selectedPosition.quantity));
  }, [selectedPosition?.id]);

  useEffect(() => {
    if (!selectedPosition || parsedCloseQuantity === null || parsedCloseQuantity === 0n) {
      setPreview(null);
      setPreviewError(null);
      setPreviewRefreshedAt(null);
      setIsPreviewLoading(false);
      return;
    }

    if (parsedCloseQuantity > selectedPosition.quantity) {
      setPreview(null);
      setPreviewError("Insufficient manager quantity");
      setPreviewRefreshedAt(null);
      return;
    }

    const oracleState = selectedPosition.oracleState;
    if (!oracleState || !canRedeem(oracleState)) {
      setPreview(null);
      setPreviewError(getOracleBlocker(oracleState));
      setPreviewRefreshedAt(null);
      return;
    }

    let isCancelled = false;
    setIsPreviewLoading(true);
    setPreviewError(null);

    const timeoutId = window.setTimeout(() => {
      const nextPreview =
        oracleState.oracle.status === "settled"
          ? Promise.resolve(
              getSettledPayout(
                { ...selectedPosition, quantity: parsedCloseQuantity },
                oracleState,
              ),
            )
          : getOracleTradeAmounts(client, {
              expiry: selectedPosition.expiry,
              isUp: selectedPosition.isUp,
              oracleId: selectedPosition.oracleId,
              quantity: parsedCloseQuantity,
              strike: selectedPosition.strike,
            }).then((amounts) => amounts.redeemPayout);

      nextPreview
        .then((redeemPayout) => {
          if (!isCancelled) {
            setPreview(redeemPayout);
            setPreviewRefreshedAt(Date.now());
          }
        })
        .catch((caughtError) => {
          if (!isCancelled) {
            setPreview(null);
            setPreviewRefreshedAt(null);
            setPreviewError(
              caughtError instanceof Error
                ? caughtError.message
                : "Redeem preview failed",
            );
          }
        })
        .finally(() => {
          if (!isCancelled) {
            setIsPreviewLoading(false);
          }
        });
    }, 250);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [client, parsedCloseQuantity, previewRefreshTick, selectedPosition]);

  useEffect(() => {
    if (!selectedPosition || parsedCloseQuantity === null || parsedCloseQuantity === 0n) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setPreviewRefreshTick((tick) => tick + 1);
    }, PREVIEW_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [parsedCloseQuantity, selectedPosition]);

  async function closePosition() {
    if (
      !account ||
      !manager ||
      !selectedPosition ||
      !selectedPosition.oracleState ||
      !parsedCloseQuantity ||
      !preview ||
      closeValidationError
    ) {
      return;
    }

    setTxError(null);
    setTxDigest(null);

    try {
      const result = await signAndExecuteTransaction({
        transaction: createRedeemAndWithdrawPositionTransaction({
          expiry: selectedPosition.expiry,
          executorAddress: account.address,
          isUp: selectedPosition.isUp,
          managerId: manager.id,
          managerOwnerAddress: manager.owner,
          oracleId: selectedPosition.oracleId,
          oracleStatus: selectedPosition.oracleState.oracle.status,
          oracleSviId: selectedPosition.oracleId,
          quantity: parsedCloseQuantity,
          recipient: account.address,
          strike: selectedPosition.strike,
          withdrawAmount: preview,
        }),
        chain: "sui:testnet",
      });

      setTxDigest(result.digest);
      setSelectedId(null);
      await loadPortfolio(false);
    } catch (caughtError) {
      setTxError(
        caughtError instanceof Error ? caughtError.message : "Redeem failed",
      );
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Portfolio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manager-owned BTC/DUSDC positions for the connected wallet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectButton />
            <Button
              disabled={!account || isLoading}
              onClick={() => void loadPortfolio()}
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>

        <section className="grid gap-3 sm:grid-cols-4">
          <Metric label="Status" value={getPortfolioStatus(account?.address, manager, isLoading)} />
          <Metric label="Manager" value={manager ? truncateAddress(manager.id) : "-"} />
          <Metric label="Open positions" value={manager ? positions.length.toString() : "-"} />
          <Metric label="Last refresh" value={refreshedAt ? formatDate(refreshedAt) : "-"} />
        </section>

        {error ? <div className="text-sm text-destructive">{error}</div> : null}

        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b border-border">
                  <Th>Oracle</Th>
                  <Th>Side</Th>
                  <Th align="right">Strike</Th>
                  <Th align="right">Quantity</Th>
                  <Th align="right">Redeem payout</Th>
                  <Th>Expiry</Th>
                  <Th>Settlement</Th>
                  <Th>State</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {!account ? (
                  <EmptyRow>Connect a wallet to load your manager portfolio.</EmptyRow>
                ) : isLoading ? (
                  <EmptyRow>Loading manager positions...</EmptyRow>
                ) : !manager ? (
                  <EmptyRow>No PredictManager found for this wallet.</EmptyRow>
                ) : positions.length === 0 ? (
                  <EmptyRow>
                    No manager-owned positions found. If you just traded, the server
                    index may still be refreshing.
                  </EmptyRow>
                ) : (
                  positions.map((position) => (
                    <tr
                      className="border-b border-border transition-colors hover:bg-muted/50"
                      key={position.id}
                    >
                      <Td mono>{truncateAddress(position.oracleId)}</Td>
                      <Td>
                        <SideBadge isUp={position.isUp} />
                      </Td>
                      <Td align="right" mono>
                        {formatTickValue(position.strike)}
                      </Td>
                      <Td align="right" mono>
                        {formatPositionQuantity(position.quantity)}
                      </Td>
                      <Td align="right" mono>
                        {position.redeemPayout === null
                          ? position.payoutError
                            ? "Unavailable"
                            : "-"
                          : formatManagerQuote(position.redeemPayout)}
                      </Td>
                      <Td>{formatDate(position.expiry)}</Td>
                      <Td>{formatSettlement(position.oracleState)}</Td>
                      <Td>{getOracleStateLabel(position.oracleState)}</Td>
                      <Td align="right">
                        <Button
                          disabled={!canRedeem(position.oracleState)}
                          onClick={() => setSelectedId(position.id)}
                          size="sm"
                          type="button"
                          variant={selectedId === position.id ? "default" : "outline"}
                        >
                          Close
                        </Button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {selectedPosition ? (
          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Close Position</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {truncateAddress(selectedPosition.oracleId)} ·{" "}
                  {selectedPosition.isUp ? "UP" : "DOWN"} ·{" "}
                  {formatTickValue(selectedPosition.strike)}
                </p>
              </div>
              <Button
                onClick={() => setSelectedId(null)}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="close-quantity">
                  Quantity
                </label>
                <Input
                  className="font-mono"
                  id="close-quantity"
                  inputMode="decimal"
                  onChange={(event) => setCloseQuantity(event.target.value)}
                  value={closeQuantity}
                />
              </div>
              <Button
                onClick={() =>
                  setCloseQuantity(
                    formatTokenInput(selectedPosition.quantity),
                  )
                }
                type="button"
                variant="outline"
              >
                Max
              </Button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Metric
                label="Payout"
                value={isPreviewLoading ? "Loading..." : preview ? formatManagerQuote(preview) : "-"}
              />
              <Metric
                label="Remaining"
                value={
                  parsedCloseQuantity && parsedCloseQuantity <= selectedPosition.quantity
                    ? formatPositionQuantity(selectedPosition.quantity - parsedCloseQuantity)
                    : "-"
                }
              />
              <Metric
                label="Pricing"
                value={
                  selectedPosition.oracleState?.oracle.status === "settled"
                    ? "Settled"
                    : "Live"
                }
              />
              <Metric
                label="Preview refresh"
                value={formatPreviewRefresh(previewRefreshInMs, isPreviewLoading)}
              />
            </div>

            {previewError || closeValidationError ? (
              <div className="mt-3 text-sm text-destructive">
                {previewError ?? closeValidationError}
              </div>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground">
                Redeem and {DEEPBOOK_PREDICT.quote.symbol} withdrawal are submitted in
                one wallet signature when the preview payout is positive.
              </div>
            )}

            {txError ? <div className="mt-3 text-sm text-destructive">{txError}</div> : null}

            {txDigest ? (
              <a
                className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                href={getSuiExplorerTxUrl(txDigest)}
                rel="noreferrer"
                target="_blank"
              >
                View transaction
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            ) : null}

            <Button
              className="mt-4"
              disabled={isTxPending || Boolean(closeValidationError)}
              onClick={() => void closePosition()}
              type="button"
            >
              {isTxPending ? "Waiting for wallet" : closeValidationError ?? "Close position"}
            </Button>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function getCloseValidationError({
  isPreviewLoading,
  isPreviewStale,
  parsedCloseQuantity,
  position,
  preview,
  previewError,
}: {
  isPreviewLoading: boolean;
  isPreviewStale: boolean;
  parsedCloseQuantity: bigint | null;
  position: PortfolioPosition | null;
  preview: bigint | null;
  previewError: string | null;
}) {
  if (!position) {
    return "Select a position";
  }

  if (parsedCloseQuantity === null || parsedCloseQuantity === 0n) {
    return "Enter a close quantity";
  }

  if (parsedCloseQuantity > position.quantity) {
    return "Insufficient manager quantity";
  }

  if (!canRedeem(position.oracleState)) {
    return getOracleBlocker(position.oracleState);
  }

  if (isPreviewLoading) {
    return "Refreshing preview";
  }

  if (previewError) {
    return previewError;
  }

  if (!preview || preview === 0n) {
    return "Zero payout";
  }

  if (isPreviewStale) {
    return "Preview is stale";
  }

  return null;
}

function canRedeem(state: OracleStateResponse | null) {
  return Boolean(state && (state.oracle.status === "settled" || isQuoteable(state)));
}

function isQuoteable(state: OracleStateResponse) {
  return state.oracle.status === "active" && state.latest_price && state.latest_svi;
}

function getOracleBlocker(state: OracleStateResponse | null) {
  if (!state) {
    return "Oracle state unavailable";
  }

  if (state.oracle.status !== "settled" && Date.now() >= state.oracle.expiry) {
    return "Oracle is expired but not settled";
  }

  return "Oracle is not quoteable";
}

function getSettledPayout(
  position: Pick<WalletPredictPosition, "isUp" | "quantity" | "strike">,
  state: OracleStateResponse,
) {
  const settlement = state.oracle.settlement_price;
  if (settlement === null) {
    return 0n;
  }

  const wins = position.isUp ? settlement > position.strike : settlement <= position.strike;
  return wins ? position.quantity : 0n;
}

function getPortfolioStatus(
  accountAddress: string | undefined,
  manager: PredictManagerSummary | null,
  isLoading: boolean,
) {
  if (!accountAddress) {
    return "Wallet needed";
  }

  if (isLoading) {
    return "Loading";
  }

  return manager ? "Ready" : "No manager";
}

function getOracleStateLabel(state: OracleStateResponse | null) {
  if (!state) {
    return "Missing";
  }

  if (state.oracle.status === "settled") {
    return "Redeem settled";
  }

  if (isQuoteable(state)) {
    return "Redeem live";
  }

  return getOracleBlocker(state);
}

function formatSettlement(state: OracleStateResponse | null) {
  if (!state) {
    return "-";
  }

  if (state.oracle.status !== "settled") {
    return state.oracle.status;
  }

  return state.oracle.settlement_price === null
    ? "settled"
    : formatTickValue(state.oracle.settlement_price, state.oracle.tick_size);
}

function formatPositionQuantity(value: bigint) {
  return formatTokenAmount(value, DEEPBOOK_PREDICT.quote.decimals);
}

function formatManagerQuote(value: bigint) {
  return `${formatTokenAmount(value, DEEPBOOK_PREDICT.quote.decimals)} ${DEEPBOOK_PREDICT.quote.symbol}`;
}

function formatTokenInput(value: bigint) {
  const divisor = 10n ** BigInt(DEEPBOOK_PREDICT.quote.decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  const fractionText = fraction
    .toString()
    .padStart(DEEPBOOK_PREDICT.quote.decimals, "0")
    .replace(/0+$/, "");

  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function formatPreviewRefresh(value: number | null, isLoading: boolean) {
  if (isLoading) {
    return "Refreshing";
  }

  if (value === null) {
    return "-";
  }

  return `${Math.ceil(value / 1_000)}s`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-border">
      <td className="p-6 text-center text-muted-foreground" colSpan={9}>
        {children}
      </td>
    </tr>
  );
}

function Th({
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

function Td({
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

function SideBadge({ isUp }: { isUp: boolean }) {
  return (
    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
      {isUp ? "UP" : "DOWN"}
    </span>
  );
}

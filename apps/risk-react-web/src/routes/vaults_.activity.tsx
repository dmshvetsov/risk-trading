import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { formatDate, formatDecimal, truncateAddress } from "@/lib/format";

const LP_SUPPLIES_URL = "https://predict-server.testnet.mystenlabs.com/lp/supplies";
const LP_WITHDRAWALS_URL =
  "https://predict-server.testnet.mystenlabs.com/lp/withdrawals";

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
  digest: string;
  event_digest: string;
  event_index: number;
  sender: string;
  shares: number;
  wallet: string;
};

export const Route = createFileRoute("/vaults_/activity")({
  component: VaultActivity,
});

function VaultActivity() {
  const [supplies, setSupplies] = useState<Array<LpSupply>>([]);
  const [withdrawals, setWithdrawals] = useState<Array<LpWithdrawal>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activity = useMemo(
    () =>
      [
        ...supplies.map(
          (supply): LpActivity => ({
            activity: "Supply",
            amount: supply.amount,
            checkpoint: supply.checkpoint,
            checkpoint_timestamp_ms: supply.checkpoint_timestamp_ms,
            digest: supply.digest,
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
            digest: withdrawal.digest,
            event_digest: withdrawal.event_digest,
            event_index: withdrawal.event_index,
            sender: withdrawal.sender,
            shares: withdrawal.shares_burned,
            wallet: withdrawal.withdrawer,
          }),
        ),
      ].sort((a, b) => b.checkpoint - a.checkpoint),
    [supplies, withdrawals],
  );

  useEffect(() => {
    const abortController = new AbortController();

    async function loadActivity() {
      setIsLoading(true);
      setError(null);

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

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load liquidity pool activity",
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadActivity();

    return () => abortController.abort();
  }, []);

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Liquidity Pool Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Supply and withdrawal activity for the BTC prediction market vault.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b border-border transition-colors hover:bg-muted/50">
                  <TableHead>Activity</TableHead>
                  <TableHead align="right">Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead align="right">Shares</TableHead>
                  <TableHead>Wallet</TableHead>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {isLoading ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-muted-foreground"
                      colSpan={6}
                    >
                      Loading liquidity pool activity...
                    </td>
                  </tr>
                ) : error ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-destructive"
                      colSpan={6}
                    >
                      {error}
                    </td>
                  </tr>
                ) : activity.length === 0 ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-muted-foreground"
                      colSpan={6}
                    >
                      No liquidity pool activity found.
                    </td>
                  </tr>
                ) : (
                  activity.map((item) => (
                    <LpActivityRow
                      activity={item}
                      key={`${item.event_digest}-${item.event_index}`}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
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
        {formatDecimal(activity.amount)}
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

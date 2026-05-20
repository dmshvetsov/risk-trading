import { useCurrentAccount } from "@mysten/dapp-kit";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatDate,
  formatInteger,
  formatTickValue,
  formatTokenAmount,
  truncateAddress,
} from "@/lib/format";
import { DEEPBOOK_PREDICT } from "@/lib/deepbook-predict";
import { cn } from "@/lib/utils";

const POSITION_FILTER_STATES = ["opened", "closed"] as const;
const DEFAULT_POSITION_FILTER_STATE = "opened";

const POSITIONS_URLS = {
  opened: "https://predict-server.testnet.mystenlabs.com/positions/minted",
  closed: "https://predict-server.testnet.mystenlabs.com/positions/redeemed",
} as const;

type PositionFilterState = (typeof POSITION_FILTER_STATES)[number];
type PositionsSearch = Record<string, unknown> & {
  filterPositionStatus: PositionFilterState;
};

type OpenedPosition = {
  ask_price: number;
  checkpoint_timestamp_ms: number;
  cost: number;
  digest: string;
  expiry: number;
  is_up: boolean;
  quantity: number;
  sender: string;
  strike: number;
  trader: string;
};

type ClosedPosition = {
  bid_price: number;
  checkpoint_timestamp_ms: number;
  digest: string;
  expiry: number;
  is_settled: boolean;
  is_up: boolean;
  owner: string;
  payout: number;
  quantity: number;
  sender: string;
  strike: number;
};

export const Route = createFileRoute("/positions")({
  validateSearch: (search: Record<string, unknown>): PositionsSearch => ({
    ...search,
    filterPositionStatus: isPositionFilterState(search.filterPositionStatus)
      ? search.filterPositionStatus
      : DEFAULT_POSITION_FILTER_STATE,
  }),
  component: Positions,
});

function isPositionFilterState(value: unknown): value is PositionFilterState {
  return (
    typeof value === "string" &&
    POSITION_FILTER_STATES.includes(value as PositionFilterState)
  );
}

function Positions() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const account = useCurrentAccount();
  const [openedPositions, setOpenedPositions] = useState<Array<OpenedPosition>>(
    [],
  );
  const [closedPositions, setClosedPositions] = useState<Array<ClosedPosition>>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activePositions = useMemo(
    () =>
      search.filterPositionStatus === "opened"
        ? openedPositions
        : closedPositions,
    [closedPositions, openedPositions, search.filterPositionStatus],
  );

  useEffect(() => {
    const abortController = new AbortController();

    async function loadPositions() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          POSITIONS_URLS[search.filterPositionStatus],
          {
            signal: abortController.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        if (search.filterPositionStatus === "opened") {
          const data = (await response.json()) as Array<OpenedPosition>;
          setOpenedPositions(data);
        } else {
          const data = (await response.json()) as Array<ClosedPosition>;
          setClosedPositions(data);
        }
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load positions",
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadPositions();

    return () => abortController.abort();
  }, [search.filterPositionStatus]);

  function updatePositionFilterState(filterPositionStatus: string) {
    if (!isPositionFilterState(filterPositionStatus)) {
      return;
    }

    void navigate({
      search: (previous) => ({
        ...previous,
        filterPositionStatus,
      }),
    });
  }

  const colSpan = search.filterPositionStatus === "opened" ? 9 : 10;

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Positions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Historic opened and closed positions for the BTC prediction market.
          </p>
        </div>

        <Tabs
          value={search.filterPositionStatus}
          onValueChange={updatePositionFilterState}
        >
          <TabsList aria-label="Position state filter">
            <TabsTrigger value="opened">Opened</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              {search.filterPositionStatus === "opened" ? (
                <OpenedPositionsHeader />
              ) : (
                <ClosedPositionsHeader />
              )}
              <tbody className="[&_tr:last-child]:border-0">
                {isLoading ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-muted-foreground"
                      colSpan={colSpan}
                    >
                      Loading positions...
                    </td>
                  </tr>
                ) : error ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-destructive"
                      colSpan={colSpan}
                    >
                      {error}
                    </td>
                  </tr>
                ) : activePositions.length === 0 ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-muted-foreground"
                      colSpan={colSpan}
                    >
                      No positions found.
                    </td>
                  </tr>
                ) : search.filterPositionStatus === "opened" ? (
                  openedPositions.map((position) => (
                    <OpenedPositionRow
                      key={position.digest}
                      position={position}
                      walletAddress={account?.address}
                    />
                  ))
                ) : (
                  closedPositions.map((position) => (
                    <ClosedPositionRow
                      key={position.digest}
                      position={position}
                      walletAddress={account?.address}
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

function OpenedPositionsHeader() {
  return (
    <thead className="[&_tr]:border-b">
      <tr className="border-b border-border transition-colors hover:bg-muted/50">
        <TableHead>Opened</TableHead>
        <TableHead>Type</TableHead>
        <TableHead align="right">Strike</TableHead>
        <TableHead align="right">Quantity</TableHead>
        <TableHead align="right">Cost ({DEEPBOOK_PREDICT.quote.symbol})</TableHead>
        <TableHead align="right">Ask Price ({DEEPBOOK_PREDICT.quote.symbol})</TableHead>
        <TableHead>Expiry</TableHead>
        <TableHead>Trader</TableHead>
        <TableHead>Sender</TableHead>
      </tr>
    </thead>
  );
}

function ClosedPositionsHeader() {
  return (
    <thead className="[&_tr]:border-b">
      <tr className="border-b border-border transition-colors hover:bg-muted/50">
        <TableHead>Closed</TableHead>
        <TableHead>Type</TableHead>
        <TableHead>Settled</TableHead>
        <TableHead align="right">Strike</TableHead>
        <TableHead align="right">Quantity</TableHead>
        <TableHead align="right">Payout ({DEEPBOOK_PREDICT.quote.symbol})</TableHead>
        <TableHead align="right">Bid Price ({DEEPBOOK_PREDICT.quote.symbol})</TableHead>
        <TableHead>Expiry</TableHead>
        <TableHead>Owner</TableHead>
        <TableHead>Sender</TableHead>
      </tr>
    </thead>
  );
}

function OpenedPositionRow({
  position,
  walletAddress,
}: {
  position: OpenedPosition;
  walletAddress?: string;
}) {
  const isWalletPosition = isSameAddress(position.trader, walletAddress);

  return (
    <tr className={getPositionRowClassName(isWalletPosition)}>
      <TableCell>{formatDate(position.checkpoint_timestamp_ms)}</TableCell>
      <TableCell>
        <PositionType isUp={position.is_up} />
      </TableCell>
      <TableCell align="right" mono>
        {formatTickValue(position.strike)}
      </TableCell>
      <TableCell align="right" mono>
        {formatInteger(position.quantity)}
      </TableCell>
      <TableCell align="right" mono>
        {formatTokenAmount(position.cost, DEEPBOOK_PREDICT.quote.decimals)}
      </TableCell>
      <TableCell align="right" mono>
        {formatTokenAmount(position.ask_price, DEEPBOOK_PREDICT.quote.decimals)}
      </TableCell>
      <TableCell>{formatDate(position.expiry)}</TableCell>
      <TableCell mono>
        <WalletAddress
          address={position.trader}
          isCurrentWallet={isWalletPosition}
        />
      </TableCell>
      <TableCell mono>{truncateAddress(position.sender)}</TableCell>
    </tr>
  );
}

function ClosedPositionRow({
  position,
  walletAddress,
}: {
  position: ClosedPosition;
  walletAddress?: string;
}) {
  const isWalletPosition = isSameAddress(position.owner, walletAddress);

  return (
    <tr className={getPositionRowClassName(isWalletPosition)}>
      <TableCell>{formatDate(position.checkpoint_timestamp_ms)}</TableCell>
      <TableCell>
        <PositionType isUp={position.is_up} />
      </TableCell>
      <TableCell>{position.is_settled ? "yes" : "no"}</TableCell>
      <TableCell align="right" mono>
        {formatTickValue(position.strike)}
      </TableCell>
      <TableCell align="right" mono>
        {formatInteger(position.quantity)}
      </TableCell>
      <TableCell align="right" mono>
        {formatTokenAmount(position.payout, DEEPBOOK_PREDICT.quote.decimals)}
      </TableCell>
      <TableCell align="right" mono>
        {formatTokenAmount(position.bid_price, DEEPBOOK_PREDICT.quote.decimals)}
      </TableCell>
      <TableCell>{formatDate(position.expiry)}</TableCell>
      <TableCell mono>
        <WalletAddress
          address={position.owner}
          isCurrentWallet={isWalletPosition}
        />
      </TableCell>
      <TableCell mono>{truncateAddress(position.sender)}</TableCell>
    </tr>
  );
}

function getPositionRowClassName(isCurrentWallet: boolean) {
  return cn(
    "border-b border-border transition-colors hover:bg-muted/50",
    isCurrentWallet &&
      "bg-primary/10 shadow-[inset_3px_0_0_var(--primary)] hover:bg-primary/15",
  );
}

function isSameAddress(address: string, walletAddress?: string) {
  return Boolean(
    walletAddress && address.toLowerCase() === walletAddress.toLowerCase(),
  );
}

function WalletAddress({
  address,
  isCurrentWallet,
}: {
  address: string;
  isCurrentWallet: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {truncateAddress(address)}
      {isCurrentWallet ? (
        <span className="rounded-sm bg-primary px-1.5 py-0.5 font-sans text-[10px] font-medium text-primary-foreground">
          You
        </span>
      ) : null}
    </span>
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

function PositionType({ isUp }: { isUp: boolean }) {
  return (
    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
      {isUp ? "call" : "put"}
    </span>
  );
}

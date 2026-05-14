import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const POSITION_FILTER_STATES = ["opened", "closed"] as const;
const DEFAULT_POSITION_FILTER_STATE = "opened";
const TICK_SIZE = 1_000_000_000;

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
                    />
                  ))
                ) : (
                  closedPositions.map((position) => (
                    <ClosedPositionRow
                      key={position.digest}
                      position={position}
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
        <TableHead align="right">Cost</TableHead>
        <TableHead align="right">Ask Price</TableHead>
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
        <TableHead align="right">Payout</TableHead>
        <TableHead align="right">Bid Price</TableHead>
        <TableHead>Expiry</TableHead>
        <TableHead>Owner</TableHead>
        <TableHead>Sender</TableHead>
      </tr>
    </thead>
  );
}

function OpenedPositionRow({ position }: { position: OpenedPosition }) {
  return (
    <tr className="border-b border-border transition-colors hover:bg-muted/50">
      <TableCell>{formatDate(position.checkpoint_timestamp_ms)}</TableCell>
      <TableCell>
        <PositionType isUp={position.is_up} />
      </TableCell>
      <TableCell align="right" mono>
        {formatTickValue(position.strike)}
      </TableCell>
      <TableCell align="right" mono>
        {formatDecimal(position.quantity)}
      </TableCell>
      <TableCell align="right" mono>
        {formatDecimal(position.cost)}
      </TableCell>
      <TableCell align="right" mono>
        {formatDecimal(position.ask_price)}
      </TableCell>
      <TableCell>{formatDate(position.expiry)}</TableCell>
      <TableCell mono>{truncateAddress(position.trader)}</TableCell>
      <TableCell mono>{truncateAddress(position.sender)}</TableCell>
    </tr>
  );
}

function ClosedPositionRow({ position }: { position: ClosedPosition }) {
  return (
    <tr className="border-b border-border transition-colors hover:bg-muted/50">
      <TableCell>{formatDate(position.checkpoint_timestamp_ms)}</TableCell>
      <TableCell>
        <PositionType isUp={position.is_up} />
      </TableCell>
      <TableCell>{position.is_settled ? "yes" : "no"}</TableCell>
      <TableCell align="right" mono>
        {formatTickValue(position.strike)}
      </TableCell>
      <TableCell align="right" mono>
        {formatDecimal(position.quantity)}
      </TableCell>
      <TableCell align="right" mono>
        {formatDecimal(position.payout)}
      </TableCell>
      <TableCell align="right" mono>
        {formatDecimal(position.bid_price)}
      </TableCell>
      <TableCell>{formatDate(position.expiry)}</TableCell>
      <TableCell mono>{truncateAddress(position.owner)}</TableCell>
      <TableCell mono>{truncateAddress(position.sender)}</TableCell>
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

function PositionType({ isUp }: { isUp: boolean }) {
  return (
    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
      {isUp ? "call" : "put"}
    </span>
  );
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const decimalFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
  minimumFractionDigits: 4,
});

function formatDate(timestamp: number) {
  return dateFormatter.format(new Date(timestamp));
}

function formatDecimal(value: number) {
  return decimalFormatter.format(value / TICK_SIZE);
}

function formatTickValue(value: number) {
  return decimalFormatter.format(value / TICK_SIZE);
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

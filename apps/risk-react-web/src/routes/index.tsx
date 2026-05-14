import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import _filter from "lodash/filter";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatTickValue } from "@/lib/format";

const ORACLE_FILTER_STATES = ["active", "settled"] as const;
const DEFAULT_ORACLE_FILTER_STATE = "active";

type OracleFilterState = (typeof ORACLE_FILTER_STATES)[number];
type HomeSearch = Record<string, unknown> & {
  filterOracleStatus: OracleFilterState;
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    ...search,
    filterOracleStatus: isOracleFilterState(search.filterOracleStatus)
      ? search.filterOracleStatus
      : DEFAULT_ORACLE_FILTER_STATE,
  }),
  component: Home,
});

const ORACLES_URL =
  "https://predict-server.testnet.mystenlabs.com/predicts/0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a/oracles";

type OracleState = {
  activated_at: number;
  created_checkpoint: number;
  expiry: number;
  min_strike: number;
  oracle_cap_id: string;
  oracle_id: string;
  predict_id: string;
  settled_at: number | null;
  settlement_price: number | null;
  status: string;
  tick_size: number;
  underlying_asset: string;
};

function isOracleFilterState(value: unknown): value is OracleFilterState {
  return (
    typeof value === "string" &&
    ORACLE_FILTER_STATES.includes(value as OracleFilterState)
  );
}

function Home() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [oracles, setOracles] = useState<Array<OracleState>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filteredOracles = useMemo(
    () =>
      oracles.filter((oracle) => oracle.status === search.filterOracleStatus),
    [oracles, search.filterOracleStatus],
  );

  useEffect(() => {
    const currentState = new URLSearchParams(window.location.search).get(
      "state",
    );

    if (currentState !== search.filterOracleStatus) {
      void navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          filterOracleStatus: search.filterOracleStatus,
        }),
      });
    }
  }, [navigate, search.filterOracleStatus]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadOracles() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(ORACLES_URL, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        const data = (await response.json()) as Array<OracleState>;
        setOracles(data);
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load oracles",
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadOracles();

    return () => abortController.abort();
  }, []);

  function updateOracleFilterState(filterOracleStatus: string) {
    if (!isOracleFilterState(filterOracleStatus)) {
      return;
    }

    void navigate({
      search: (previous) => ({
        ...previous,
        filterOracleStatus,
      }),
    });
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Oracle States</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Current oracle data for the BTC prediction market.
          </p>
        </div>

        <Tabs
          value={search.filterOracleStatus}
          onValueChange={updateOracleFilterState}
        >
          <TabsList aria-label="Oracle state filter">
            <TabsTrigger value="active">
              Active{" "}
              <span className="font-mono">
                {_filter(oracles, { status: "active" }).length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="settled">
              Settled{" "}
              <span className="font-mono">
                {_filter(oracles, { status: "settled" }).length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b border-border transition-colors hover:bg-muted/50">
                  <th className="h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-muted-foreground">
                    Asset
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-muted-foreground">
                    Status
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-muted-foreground">
                    Activated
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-muted-foreground">
                    Expiry
                  </th>
                  <th className="h-10 px-3 text-right align-middle font-medium whitespace-nowrap text-muted-foreground">
                    Min Strike
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-muted-foreground">
                    Settled
                  </th>
                  <th className="h-10 px-3 text-right align-middle font-medium whitespace-nowrap text-muted-foreground">
                    Settlement Price
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {isLoading ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      Loading oracles...
                    </td>
                  </tr>
                ) : error ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-destructive"
                      colSpan={7}
                    >
                      {error}
                    </td>
                  </tr>
                ) : filteredOracles.length === 0 ? (
                  <tr className="border-b border-border">
                    <td
                      className="p-6 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      No oracle states found.
                    </td>
                  </tr>
                ) : (
                  filteredOracles.map((oracle) => (
                    <tr
                      className="border-b border-border transition-colors hover:bg-muted/50"
                      key={oracle.oracle_id}
                    >
                      <td className="p-3 align-middle font-medium whitespace-nowrap">
                        {oracle.underlying_asset}
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">
                        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                          {oracle.status}
                        </span>
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">
                        {formatDate(oracle.activated_at)}
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">
                        {formatDate(oracle.expiry)}
                      </td>
                      <td className="p-3 text-right align-middle font-mono whitespace-nowrap">
                        {formatTickValue(oracle.min_strike, oracle.tick_size, {
                          minimumFractionDigits: 0,
                          nullValue: "n/a",
                        })}
                      </td>
                      <td className="p-3 align-middle whitespace-nowrap">
                        {formatDate(oracle.settled_at, { nullValue: "-" })}
                      </td>
                      <td className="p-3 text-right align-middle font-mono whitespace-nowrap">
                        {formatTickValue(
                          oracle.settlement_price,
                          oracle.tick_size,
                          { minimumFractionDigits: 0, nullValue: "n/a" },
                        )}
                      </td>
                    </tr>
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

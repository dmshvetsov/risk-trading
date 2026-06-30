import { queryOptions } from "@tanstack/react-query";

import type { QuoteStrategy } from "@/lib/quote-request";

export type SeriesGridMarket = {
  baseDecimals: number;
  baseCoinType: string;
  marketId: string;
  oracleBaseSymbol: string;
  oracleFeedId: string;
  oracleQuoteSymbol: string;
  quoteDecimals: number;
  quoteCoinType: string;
  strikeScale: number;
};

export type SeriesGridItem = {
  expiryUnixMs: number;
  seriesId: string;
  strikePriceDecimals: string;
};

export type SeriesGrid = {
  market: SeriesGridMarket;
  spot: {
    price: number;
    publishTime: number;
    symbol: "BTC";
  };
  series: {
    call: SeriesGridItem[];
    put: SeriesGridItem[];
  };
};

export type ExpiryOption = {
  expiryUnixMs: number;
  label: string;
};

export type StrikeOption = {
  label: string;
  seriesId: string;
  strike: number;
  strikePriceDecimals: string;
};

export async function fetchSeriesGrid(
  rfqApiUrl: string,
  request: typeof fetch = fetch,
) {
  const response = await request(`${rfqApiUrl}/api/series`);
  if (!response.ok) {
    throw new Error("Series grid unavailable");
  }

  return await response.json() as SeriesGrid;
}

export function seriesGridQueryOptions(
  rfqApiUrl: string,
  request: typeof fetch = fetch,
) {
  return queryOptions({
    queryFn: () => fetchSeriesGrid(rfqApiUrl, request),
    queryKey: ["series-grid", rfqApiUrl] as const,
    retry: 1,
    staleTime: 15_000,
  });
}

export function seriesForStrategy(
  grid: SeriesGrid | null | undefined,
  strategy: QuoteStrategy,
) {
  if (!grid) {
    return [];
  }

  return strategy === "covered-call" ? grid.series.call : grid.series.put;
}

export function expiryOptionsFromSeries(series: readonly SeriesGridItem[]) {
  return [...new Set(series.map((item) => item.expiryUnixMs))]
    .sort((left, right) => left - right)
    .map((expiryUnixMs) => ({
      expiryUnixMs,
      label: formatExpiryButton(expiryUnixMs),
    }));
}

export function strikeOptionsForExpiry(
  series: readonly SeriesGridItem[],
  expiryUnixMs: number | null,
  strikeScale: number,
) {
  if (expiryUnixMs === null) {
    return [];
  }

  return series
    .filter((item) => item.expiryUnixMs === expiryUnixMs)
    .map((item) => {
      const strike = strikePriceFromDecimals(item.strikePriceDecimals, strikeScale);
      return {
        label: formatStrikeButton(strike),
        seriesId: item.seriesId,
        strike,
        strikePriceDecimals: item.strikePriceDecimals,
      };
    });
}

export function formatExpiryButton(expiryUnixMs: number) {
  return new Date(expiryUnixMs).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatStrikeButton(strike: number) {
  return `$${strike.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function strikePriceFromDecimals(
  strikePriceDecimals: string,
  strikeScale: number,
) {
  return Number(strikePriceDecimals) / strikeScale;
}

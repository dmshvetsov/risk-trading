import type React from "react";
import { memo, useMemo } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  OracleTrade,
  WalletPredictPosition,
} from "@/lib/deepbook-predict";
import { formatPredictDirection, formatTickValue } from "@/lib/format";

const TRADE_PREVIEW_UNIT_QUANTITY = 1_000_000n;
const OPEN_POSITIONS_WINDOW_MS = 24 * 60 * 60 * 1_000;
const OPEN_POSITIONS_PRICE_STEP = 500;

type OpenPositionChartPoint = {
  direction: "ABOVE" | "BELOW";
  hour: number;
  id: string;
  quantity: number;
  strike: number;
};

type NormalizedOpenPositionTrade = {
  direction: "ABOVE" | "BELOW";
  hour: number;
  quantity: number;
  strike: number;
  tradeType: "mint" | "redeem";
};

type SplitOpenPositionChartPoint = {
  downQuantity: number;
  hour: number;
  id: string;
  quantity: number;
  strike: number;
  upQuantity: number;
};

type OpenPositionsChartSource =
  | {
      positions: Array<WalletPredictPosition>;
      trades?: never;
    }
  | {
      positions?: never;
      trades: Array<OracleTrade>;
    };

const openPositionsChartConfig = {
  up: {
    label: "ABOVE",
    color: "var(--chart-1)",
  },
  down: {
    label: "BELOW",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export const OpenPositionsChart = memo(function OpenPositionsChart({
  emptyState,
  spot,
  tickSize,
  title = "Open Contracts",
  ...source
}: OpenPositionsChartSource & {
  emptyState?: string;
  spot: number | null;
  tickSize: number;
  title?: string;
}) {
  const now = Date.now();
  const windowStart = now - OPEN_POSITIONS_WINDOW_MS;
  const chartPoints = useMemo(
    () =>
      "trades" in source
        ? buildTradeChartPoints({
            now,
            tickSize,
            trades: source.trades,
            windowStart,
          })
        : buildPositionChartPoints({
            now,
            positions: source.positions,
            tickSize,
          }),
    [now, source, tickSize, windowStart],
  );
  const splitPoints = useMemo(
    () => buildSplitOpenPositionChartPoints(chartPoints),
    [chartPoints],
  );
  const xTicks = useMemo(() => buildOpenPositionsHourTicks(windowStart, now), [
    now,
    windowStart,
  ]);
  const yDomain = getOpenPositionsPriceDomain(chartPoints, spot, tickSize);
  const maxQuantity = Math.max(1, ...chartPoints.map((point) => point.quantity));

  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex flex-wrap gap-3 text-xs">
          <LegendItem color="var(--chart-1)" label="ABOVE">
            Open long-above quantity.
          </LegendItem>
          <LegendItem color="var(--chart-2)" label="BELOW">
            Open long-below quantity.
          </LegendItem>
        </div>
      </div>
      {chartPoints.length > 0 ? (
        <ChartContainer
          config={openPositionsChartConfig}
          className="min-h-80 flex-1"
        >
          <ScatterChart margin={{ bottom: 8, left: 8, right: 20, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="hour"
              domain={[windowStart, now]}
              name="Hour"
              interval="preserveStartEnd"
              scale="time"
              tickFormatter={(value) => formatHour(Number(value))}
              tickMargin={8}
              ticks={xTicks}
              type="number"
            />
            <YAxis
              dataKey="strike"
              domain={yDomain}
              name="Strike"
              tickFormatter={(value) => formatTickValue(Number(value), tickSize)}
              type="number"
            />
            <ZAxis dataKey="quantity" domain={[0, maxQuantity]} range={[90, 720]} />
            {spot ? (
              <ReferenceLine
                y={roundPriceToStep(spot, tickSize)}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
              />
            ) : null}
            <Tooltip
              content={<OpenPositionsTooltip tickSize={tickSize} />}
              cursor={{ stroke: "var(--border)" }}
              isAnimationActive={false}
            />
            <Scatter
              data={splitPoints}
              dataKey="quantity"
              isAnimationActive={false}
              shape={<SplitPositionShape maxQuantity={maxQuantity} />}
            />
          </ScatterChart>
        </ChartContainer>
      ) : (
        <EmptyState>
          {emptyState ?? "No open position activity in the last 24 hours."}
        </EmptyState>
      )}
    </section>
  );
});

function OpenPositionsTooltip({
  active,
  payload,
  tickSize,
}: React.ComponentProps<typeof Tooltip> & { tickSize: number }) {
  const point = payload?.[0]?.payload as SplitOpenPositionChartPoint | undefined;

  if (!active || !point) {
    return null;
  }

  return (
    <div className="grid min-w-40 gap-1.5 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{formatHour(point.hour)}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">ABOVE</span>
        <span className="font-mono">{formatChartQuantity(point.upQuantity)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">BELOW</span>
        <span className="font-mono">{formatChartQuantity(point.downQuantity)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Strike</span>
        <span className="font-mono">{formatTickValue(point.strike, tickSize)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono">{formatChartQuantity(point.quantity)}</span>
      </div>
    </div>
  );
}

function SplitPositionShape({
  cx,
  cy,
  maxQuantity,
  payload,
}: {
  cx?: number;
  cy?: number;
  maxQuantity: number;
  payload?: SplitOpenPositionChartPoint;
}) {
  if (!payload || cx === undefined || cy === undefined) {
    return null;
  }

  const maxRadius = 18;
  const minRadius = 4;
  const upRadius =
    payload.upQuantity > 0
      ? Math.max(minRadius, Math.sqrt(payload.upQuantity / maxQuantity) * maxRadius)
      : 0;
  const downRadius =
    payload.downQuantity > 0
      ? Math.max(minRadius, Math.sqrt(payload.downQuantity / maxQuantity) * maxRadius)
      : 0;
  const hasUp = payload.upQuantity > 0;
  const hasDown = payload.downQuantity > 0;

  if (hasUp && !hasDown) {
    return (
      <circle
        cx={cx}
        cy={cy}
        fill="var(--color-up)"
        r={upRadius}
        stroke="var(--background)"
        strokeWidth={1}
      />
    );
  }

  if (hasDown && !hasUp) {
    return (
      <circle
        cx={cx}
        cy={cy}
        fill="var(--color-down)"
        r={downRadius}
        stroke="var(--background)"
        strokeWidth={1}
      />
    );
  }

  return (
    <g>
      {upRadius > 0 ? (
        <path
          d={upperSemicirclePath(cx, cy, upRadius)}
          fill="var(--color-up)"
          stroke="var(--background)"
          strokeWidth={1}
        />
      ) : null}
      {downRadius > 0 ? (
        <path
          d={lowerSemicirclePath(cx, cy, downRadius)}
          fill="var(--color-down)"
          stroke="var(--background)"
          strokeWidth={1}
        />
      ) : null}
      <line
        stroke="var(--foreground)"
        strokeOpacity={0.45}
        strokeWidth={1}
        x1={cx - Math.max(upRadius, downRadius)}
        x2={cx + Math.max(upRadius, downRadius)}
        y1={cy}
        y2={cy}
      />
    </g>
  );
}

function LegendItem({
  children,
  color,
  label,
}: {
  children: React.ReactNode;
  color: string;
  label: string;
}) {
  return (
    <div className="flex max-w-48 items-start gap-2">
      <span
        className="mt-1.5 h-0.5 w-4 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="ml-1 text-muted-foreground">{children}</span>
      </span>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-80 flex-1 items-center justify-center text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function buildTradeChartPoints({
  now,
  tickSize,
  trades,
  windowStart,
}: {
  now: number;
  tickSize: number;
  trades: Array<OracleTrade>;
  windowStart: number;
}) {
  const grouped = new Map<string, OpenPositionChartPoint>();
  const openBucketsByMarket = new Map<string, Array<{ bucketKey: string; quantity: number }>>();
  const tradePoints = trades
    .map((trade) => normalizeTradeChartInput(trade))
    .filter((trade) => trade && trade.hour >= floorToHour(windowStart) && trade.hour <= now)
    .sort((a, b) => a.hour - b.hour || a.strike - b.strike);

  for (const trade of tradePoints) {
    if (!trade) {
      continue;
    }

    const bucket = {
      direction: trade.direction,
      hour: trade.hour,
      strike: roundPriceToStep(trade.strike, tickSize),
    };
    const marketKey = `${bucket.strike}:${bucket.direction}`;
    const openBuckets = openBucketsByMarket.get(marketKey) ?? [];

    if (trade.tradeType === "redeem") {
      let remainingQuantity = trade.quantity;

      for (const openBucket of openBuckets) {
        if (remainingQuantity <= 0) {
          break;
        }

        const matchedQuantity = Math.min(openBucket.quantity, remainingQuantity);
        openBucket.quantity -= matchedQuantity;
        remainingQuantity -= matchedQuantity;
        addOpenPositionChartPoint(grouped, {
          ...parseBucketKey(openBucket.bucketKey),
          quantity: -matchedQuantity,
        });
      }

      openBucketsByMarket.set(
        marketKey,
        openBuckets.filter((openBucket) => openBucket.quantity > 0),
      );
      continue;
    }

    const bucketKey = getOpenPositionChartPointKey(bucket);
    const existingBucket = openBuckets.find((openBucket) => openBucket.bucketKey === bucketKey);

    if (existingBucket) {
      existingBucket.quantity += trade.quantity;
    } else {
      openBuckets.push({
        bucketKey,
        quantity: trade.quantity,
      });
      openBucketsByMarket.set(marketKey, openBuckets);
    }

    addOpenPositionChartPoint(grouped, {
      ...bucket,
      quantity: trade.quantity,
    });
  }

  return [...grouped.values()].sort((a, b) => a.hour - b.hour || a.strike - b.strike);
}

function buildPositionChartPoints({
  now,
  positions,
  tickSize,
}: {
  now: number;
  positions: Array<WalletPredictPosition>;
  tickSize: number;
}) {
  const grouped = new Map<string, OpenPositionChartPoint>();

  for (const position of positions) {
    addOpenPositionChartPoint(grouped, {
      direction: formatPredictDirection(position.isUp),
      hour: floorToHour(now),
      quantity: Number(position.quantity) / Number(TRADE_PREVIEW_UNIT_QUANTITY),
      strike: roundPriceToStep(position.strike, tickSize),
    });
  }

  return [...grouped.values()].sort((a, b) => a.hour - b.hour || a.strike - b.strike);
}

function addOpenPositionChartPoint(
  grouped: Map<string, OpenPositionChartPoint>,
  point: Pick<OpenPositionChartPoint, "direction" | "hour" | "quantity" | "strike">,
) {
  const { direction, hour, quantity, strike } = point;
  const key = getOpenPositionChartPointKey({ direction, hour, strike });
  const current = grouped.get(key);

  if (current) {
    current.quantity += quantity;
    if (current.quantity <= 0) {
      grouped.delete(key);
    }
  } else {
    if (quantity > 0) {
      grouped.set(key, {
        direction,
        hour,
        id: key,
        quantity,
        strike,
      });
    }
  }
}

function buildSplitOpenPositionChartPoints(points: Array<OpenPositionChartPoint>) {
  const grouped = new Map<string, SplitOpenPositionChartPoint>();

  for (const point of points) {
    const key = `${point.hour}:${point.strike}`;
    const current =
      grouped.get(key) ??
      ({
        downQuantity: 0,
        hour: point.hour,
        id: key,
        quantity: 0,
        strike: point.strike,
        upQuantity: 0,
      } satisfies SplitOpenPositionChartPoint);

    if (point.direction === "ABOVE") {
      current.upQuantity += point.quantity;
    } else {
      current.downQuantity += point.quantity;
    }

    current.quantity = current.upQuantity + current.downQuantity;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((a, b) => a.hour - b.hour || a.strike - b.strike);
}

function buildOpenPositionsHourTicks(windowStart: number, now: number) {
  const ticks: Array<number> = [];
  const firstHour = floorToHour(windowStart + 60 * 60 * 1_000);

  for (let tick = firstHour; tick < now; tick += 4 * 60 * 60 * 1_000) {
    ticks.push(tick);
  }

  return [windowStart, ...ticks, now];
}

function normalizeTradeChartInput(trade: OracleTrade) {
  const timestamp = normalizeTradeTimestamp(
    trade.checkpoint_timestamp_ms ?? trade.tx_timestamp_ms ?? trade.timestamp,
  );

  if (
    timestamp === null ||
    trade.strike === undefined ||
    trade.is_up === undefined ||
    trade.quantity === undefined
  ) {
    return null;
  }

  return {
    direction: formatPredictDirection(trade.is_up),
    hour: floorToHour(timestamp),
    quantity: trade.quantity / Number(TRADE_PREVIEW_UNIT_QUANTITY),
    strike: trade.strike,
    tradeType: normalizeTradeType(trade.trade_type),
  };
}

function normalizeTradeType(tradeType: string | undefined): "mint" | "redeem" {
  return tradeType?.toLowerCase() === "redeem" ? "redeem" : "mint";
}

function getOpenPositionChartPointKey({
  direction,
  hour,
  strike,
}: Pick<OpenPositionChartPoint, "direction" | "hour" | "strike">) {
  return `${hour}:${strike}:${direction}`;
}

function parseBucketKey(bucketKey: string): Pick<OpenPositionChartPoint, "direction" | "hour" | "strike"> {
  const [hour, strike, direction] = bucketKey.split(":");

  return {
    direction: direction as OpenPositionChartPoint["direction"],
    hour: Number(hour),
    strike: Number(strike),
  };
}

function normalizeTradeTimestamp(timestamp: number | undefined) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) {
    return null;
  }

  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function getOpenPositionsPriceDomain(
  points: Array<OpenPositionChartPoint>,
  spot: number | null,
  tickSize: number,
): [number, number] {
  const priceStep = OPEN_POSITIONS_PRICE_STEP * tickSize;
  const axisPadding = 1_000 * tickSize;
  const prices = points.map((point) => point.strike);
  const center = spot ? roundPriceToStep(spot, tickSize) : prices[0] ?? 0;
  const lowerData = Math.min(center, ...prices);
  const upperData = Math.max(center, ...prices);
  const radius = Math.max(
    priceStep,
    Math.ceil(
      Math.max(center - lowerData + axisPadding, upperData - center + axisPadding) /
        priceStep,
    ) * priceStep,
  );

  return [center - radius, center + radius];
}

function floorToHour(timestamp: number) {
  const date = new Date(timestamp);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function formatHour(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatChartQuantity(quantity: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
  }).format(quantity);
}

function upperSemicirclePath(cx: number, cy: number, radius: number) {
  return [
    `M ${cx - radius} ${cy}`,
    `A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`,
    `L ${cx - radius} ${cy}`,
    "Z",
  ].join(" ");
}

function lowerSemicirclePath(cx: number, cy: number, radius: number) {
  return [
    `M ${cx - radius} ${cy}`,
    `A ${radius} ${radius} 0 0 0 ${cx + radius} ${cy}`,
    `L ${cx - radius} ${cy}`,
    "Z",
  ].join(" ");
}

function roundPriceToStep(value: number, tickSize: number) {
  const priceStep = OPEN_POSITIONS_PRICE_STEP * tickSize;
  return Math.round(value / priceStep) * priceStep;
}

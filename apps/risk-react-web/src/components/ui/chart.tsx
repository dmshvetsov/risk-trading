import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

export type ChartConfig = {
  [key: string]: {
    color?: string;
    label?: React.ReactNode;
  };
};

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a ChartContainer");
  }

  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-grid_line[stroke='#ccc']]:stroke-border/70 [&_.recharts-tooltip-cursor]:stroke-border",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={0}
        >
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, value]) => value.color);

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
[data-chart=${id}] {
${colorConfig
  .map(([key, item]) => `  --color-${key}: ${item.color};`)
  .join("\n")}
}
`,
      }}
    />
  );
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  valueFormatter,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> & {
  className?: string;
  valueFormatter?: (value: unknown, name: string) => React.ReactNode;
}) {
  const { config } = useChart();

  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div
      className={cn(
        "grid min-w-32 gap-1.5 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
        className,
      )}
    >
      {label ? <div className="font-medium">{label}</div> : null}
      <div className="grid gap-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          const itemConfig = config[key];
          const value = valueFormatter
            ? valueFormatter(item.value, key)
            : String(item.value ?? "");

          return (
            <div className="flex items-center justify-between gap-4" key={key}>
              <div className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor:
                      item.color ?? itemConfig?.color ?? "var(--border)",
                  }}
                />
                <span className="text-muted-foreground">
                  {itemConfig?.label ?? item.name ?? key}
                </span>
              </div>
              <span className="font-mono tabular-nums">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

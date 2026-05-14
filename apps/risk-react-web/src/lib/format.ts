const DEFAULT_TICK_SIZE = 1_000_000_000;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const flexibleNumberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
  minimumFractionDigits: 0,
});

const fixedDecimalFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
  minimumFractionDigits: 4,
});

type NullableFormatOptions = {
  nullValue?: string;
};

type TickValueFormatOptions = NullableFormatOptions & {
  minimumFractionDigits?: 0 | 4;
};

export function formatDate(
  timestamp: number | null,
  opts: NullableFormatOptions = {},
) {
  if (timestamp === null) {
    return opts.nullValue ?? "";
  }

  return dateFormatter.format(new Date(timestamp));
}

export function formatDecimal(value: number, tickSize = DEFAULT_TICK_SIZE) {
  return fixedDecimalFormatter.format(value / tickSize);
}

export function formatTickValue(
  value: number | null,
  tickSize = DEFAULT_TICK_SIZE,
  opts: TickValueFormatOptions = {},
) {
  if (value === null) {
    return opts.nullValue ?? "";
  }

  const formatter =
    opts.minimumFractionDigits === 0
      ? flexibleNumberFormatter
      : fixedDecimalFormatter;

  return formatter.format(value / tickSize);
}

export function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

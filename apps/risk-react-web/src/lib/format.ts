const DEFAULT_TICK_SIZE = 1_000_000_000;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const flexibleNumberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
  minimumFractionDigits: 0,
});

const integerFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

type NullableFormatOptions = {
  nullValue?: string;
};

type TickValueFormatOptions = NullableFormatOptions & {
  minimumFractionDigits?: 0;
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
  return flexibleNumberFormatter.format(value / tickSize);
}

export function formatInteger(value: number) {
  return integerFormatter.format(value);
}

export function formatTokenAmount(value: bigint | number, decimals: number) {
  const baseUnits = typeof value === "bigint" ? value : BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const whole = baseUnits / divisor;
  const fraction = baseUnits % divisor;
  const fractionText = fraction.toString().padStart(decimals, "0");
  const trimmedFraction = fractionText.replace(/0+$/, "").slice(0, 4);

  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}

export function formatTickValue(
  value: number | null,
  tickSize = DEFAULT_TICK_SIZE,
  opts: TickValueFormatOptions = {},
) {
  if (value === null) {
    return opts.nullValue ?? "";
  }

  return flexibleNumberFormatter.format(value / tickSize);
}

export function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

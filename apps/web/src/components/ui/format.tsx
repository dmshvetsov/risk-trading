export function PriceUsd({ value }: { value: number }) {
  const formattedValue = value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return <span className="font-numbers">${formattedValue}</span>;
}

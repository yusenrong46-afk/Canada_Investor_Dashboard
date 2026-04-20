export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatSignedCurrency(value: number): string {
  return value >= 0 ? `+${formatCurrency(value)}` : `-${formatCurrency(Math.abs(value))}`;
}

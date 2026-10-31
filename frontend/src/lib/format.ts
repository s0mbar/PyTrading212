const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const wholeEuroFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });

export function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}

export function formatWholeEuros(value: number): string {
  return wholeEuroFormatter.format(value);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString("fr-FR") : "-";
}

export function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function signClass(value: number): string {
  return value >= 0 ? "up" : "down";
}

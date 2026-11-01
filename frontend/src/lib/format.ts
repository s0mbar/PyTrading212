const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}:${digits}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    } catch {
      // Unknown ISO code (e.g. "GBX" pence): plain number + code.
      formatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    moneyFormatters.set(key, formatter);
  }
  return formatter;
}

const numberFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });
const pctFormatter = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const relativeFormatter = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

export function formatMoney(value: number, currency = "EUR"): string {
  const formatted = moneyFormatter(currency, 2).format(value);
  return /[A-Z]{3}|€|\$|£/.test(formatted) ? formatted : `${formatted} ${currency}`;
}

export function formatWholeEuros(value: number): string {
  return moneyFormatter("EUR", 0).format(value);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** Ratio (0.123) → "+12,3 %". */
export function formatPct(ratio: number): string {
  return pctFormatter.format(ratio);
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString("fr-FR") : "-";
}

export function formatDateTime(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
    : "-";
}

/** "il y a 3 min", "dans 2 h"… */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) {
    return "jamais";
  }
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) {
    return "à l'instant";
  }
  if (abs < 3600) {
    return relativeFormatter.format(Math.round(seconds / 60), "minute");
  }
  if (abs < 86400) {
    return relativeFormatter.format(Math.round(seconds / 3600), "hour");
  }
  return relativeFormatter.format(Math.round(seconds / 86400), "day");
}

export function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function signClass(value: number): string {
  if (value > 0) {
    return "up";
  }
  return value < 0 ? "down" : "";
}

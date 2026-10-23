// spec: docs/frontend/utils.md#frontend-utils

// ── formatCompactUsd ─────────────────────────────────────────────────────────

function compactParts(abs: number): { mantissa: number; unit: "" | "K" | "M" } {
  const units = ["", "K", "M"] as const;
  let index = abs >= 1_000_000 ? 2 : abs >= 1_000 ? 1 : 0;
  let mantissa = abs / 1000 ** index;
  while (index < 2 && Math.round(mantissa * 100) / 100 >= 1000) {
    index += 1;
    mantissa = abs / 1000 ** index;
  }
  return { mantissa, unit: units[index] ?? "" };
}

export function formatCompactUsd(
  base6Decimal: string | null | undefined,
): string {
  if (base6Decimal == null) return "—";
  const num = parseFloat(base6Decimal);
  if (!Number.isFinite(num)) return "—";
  if (num === 0) return "$0";

  const sign = num < 0 ? "-" : "";
  const { mantissa, unit } = compactParts(Math.abs(num));
  return `${sign}$${trimDecimals(mantissa)}${unit}`;
}

function trimDecimals(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

// ── formatCompactUsd2dp ───────────────────────────────────────────────────────

export function formatCompactUsd2dp(
  base6Decimal: string | null | undefined,
): string {
  if (base6Decimal == null) return "—";
  const num = parseFloat(base6Decimal);
  if (!Number.isFinite(num)) return "—";

  const sign = num < 0 ? "-" : "";
  const { mantissa, unit } = compactParts(Math.abs(num));
  return `${sign}$${mantissa.toFixed(2)}${unit}`;
}

// ── formatFullUsd ─────────────────────────────────────────────────────────────

export function formatFullUsd(base6Decimal: string | null | undefined): string {
  if (base6Decimal == null) return "—";
  const num = parseFloat(base6Decimal);
  if (!Number.isFinite(num)) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(num);
  return `$${formatted}`;
}

// ── formatUsdInputValue ───────────────────────────────────────────────────────

export function formatUsdInputValue(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const dotIndex = cleaned.indexOf(".");
  const integerPart = dotIndex === -1 ? cleaned : cleaned.slice(0, dotIndex);
  const fractionPart =
    dotIndex === -1 ? null : cleaned.slice(dotIndex + 1).replace(/\./g, "");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fractionPart == null ? grouped : `${grouped}.${fractionPart}`;
}

// ── formatBpsRate ─────────────────────────────────────────────────────────────

export function formatBpsRate(bps: number | null | undefined): string {
  if (bps == null) return "—";
  if (!Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

export function parseUsdCentsInput(raw: string): string | null {
  const value = raw.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return /[1-9]/.test(value) ? value : null;
}

export function formatUsdDecimal(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

// spec: docs/frontend/utils.md
// ── formatCompactUsd ─────────────────────────────────────────────────────────

export function formatCompactUsd(
  base6Decimal: string | null | undefined,
): string {
  if (base6Decimal == null) return "—";
  const num = parseFloat(base6Decimal);
  if (!Number.isFinite(num)) return "—";
  if (num === 0) return "$0";

  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    const val = abs / 1_000_000;
    return `${sign}$${val.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const val = abs / 1_000;
    return `${sign}$${val.toFixed(1)}K`;
  }
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── formatOneDecimalRate ──────────────────────────────────────────────────────

export function formatOneDecimalRate(rate: string | null | undefined): string {
  if (rate == null) return "—";
  const num = parseFloat(rate);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

// ── formatBpsRate ─────────────────────────────────────────────────────────────

export function formatBpsRate(bps: number | null | undefined): string {
  if (bps == null) return "—";
  if (!Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(1)}%`;
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

// ── economicsUsdDecimal ──────────────────────────────────────────────────────

export function economicsUsdDecimal(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

// ── formatLtvBps ─────────────────────────────────────────────────────────────

export const LTV_NO_VALUE_SENTINEL = 4_294_967_295;

export function formatLtvBps(bps: unknown): string {
  if (typeof bps !== "number" || !Number.isFinite(bps)) return "—";
  if (bps === LTV_NO_VALUE_SENTINEL) return "No security value";
  const pct = (Math.ceil(bps / 10) / 10).toFixed(1);
  return `${pct.endsWith(".0") ? pct.slice(0, -2) : pct}%`;
}

// ── formatCoverage ────────────────────────────────────────────────────────────

export function formatCoverage(coverage: string | null | undefined): string {
  if (coverage == null) return "—";
  const num = parseFloat(coverage);
  if (!Number.isFinite(num)) return "—";
  return `${num.toFixed(1)}x`;
}

// ── formatDurationDays ────────────────────────────────────────────────────────

export function formatDurationDays(
  days: number | null | undefined,
  variant: "compact" | "long" = "compact",
): string {
  if (days == null) return "—";
  if (!Number.isFinite(days)) return "—";
  const d = Math.round(days);
  return variant === "long" ? `${d} days` : `${d}d`;
}

// ── formatEstimatedWaitDays ───────────────────────────────────────────────────

export function formatEstimatedWaitDays(
  days: string | null | undefined,
): string {
  if (days == null) return "—";
  const num = parseFloat(days);
  if (!Number.isFinite(num)) return "—";
  return `~${num.toFixed(1)} days`;
}

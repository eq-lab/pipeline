/**
 * Compact USD formatting utilities for the Loan Book panel.
 *
 * `formatCompactUsd` — formats base-6 decimal strings (already in human units,
 * e.g. `"8000000.000000"` = 8 M USDC) as compact dollar amounts (`"$8.0M"`).
 *
 * Sibling helpers used in the same panel:
 *   - `formatOneDecimalRate`  — one-decimal percentage from a decimal-fraction string.
 *   - `formatLtv`             — percentage from a 4-decimal fraction string.
 *   - `formatCoverage`        — "1.5x" from a 2-decimal ratio string.
 *   - `formatDurationDays`    — "120d" (table) / "68 days" (summary card).
 */

// ── formatCompactUsd ─────────────────────────────────────────────────────────

/**
 * Formats a base-6 decimal-string USDC amount as compact notation.
 *
 * The input is already in *human* units with a decimal point (e.g.
 * `"8000000.000000"` = $8 M). Do **not** pass raw sub-unit bigints — those
 * belong to `formatUsdc`/`parseUnits`.
 *
 * - `"8000000.000000"`  → `"$8.0M"`
 * - `"31600000.000000"` → `"$31.6M"`
 * - `"500000.000000"`   → `"$500.0K"`
 * - `"1200.000000"`     → `"$1.2K"`
 * - `"0.000000"`        → `"$0"`
 * - `null | undefined`  → `"—"`
 * - non-numeric input   → `"—"`
 */
export function formatCompactUsd(
  base6Decimal: string | null | undefined,
): string {
  if (base6Decimal == null) return "—";
  const num = parseFloat(base6Decimal);
  if (!Number.isFinite(num)) return "—";
  if (num === 0) return "$0";

  // Intl compact notation gives e.g. "$8M"; we need one decimal: "$8.0M".
  // Build it manually from the magnitude.
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
  // Sub-thousand: show 2 decimal places with thousands separator.
  // e.g. "0.900000" → "$0.90", "12.5" → "$12.50", "999" → "$999.00".
  // `Math.round` is intentionally NOT used here — it would discard cents.
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── formatOneDecimalRate ──────────────────────────────────────────────────────

/**
 * Formats a decimal-fraction rate/yield string as a one-decimal percentage.
 *
 * Per the issue-717 design decision, rates are shown at one decimal place
 * (`11.2%`) instead of the two-decimal `formatApy` output (`11.20%`).
 *
 * - `"0.112000"` → `"11.2%"`
 * - `"0.106000"` → `"10.6%"`
 * - `"0"`        → `"0.0%"`
 * - `null`       → `"—"`
 */
export function formatOneDecimalRate(rate: string | null | undefined): string {
  if (rate == null) return "—";
  const num = parseFloat(rate);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

// ── formatLtv ────────────────────────────────────────────────────────────────

/**
 * Formats a 4-decimal fraction LTV string as a rounded integer percentage.
 *
 * - `"0.8511"` → `"85%"`
 * - `"1.0000"` → `"100%"`
 * - `null`     → `"—"`
 */
export function formatLtv(ltv: string | null | undefined): string {
  if (ltv == null) return "—";
  const num = parseFloat(ltv);
  if (!Number.isFinite(num)) return "—";
  // toLocaleString adds thousands separator for large LTV values, e.g.
  // "1333.3333" → "133,333%". Normal values unaffected: "0.8511" → "85%".
  return `${Math.round(num * 100).toLocaleString("en-US")}%`;
}

// ── formatCoverage ────────────────────────────────────────────────────────────

/**
 * Formats a 2-decimal ratio string as a one-decimal "x" suffix.
 *
 * - `"1.50"` → `"1.5x"`
 * - `"2.00"` → `"2.0x"`
 * - `null`   → `"—"`
 */
export function formatCoverage(coverage: string | null | undefined): string {
  if (coverage == null) return "—";
  const num = parseFloat(coverage);
  if (!Number.isFinite(num)) return "—";
  return `${num.toFixed(1)}x`;
}

// ── formatDurationDays ────────────────────────────────────────────────────────

/**
 * Formats a duration in whole days.
 *
 * Two variants:
 *   - `compact` (default) — `"120d"`  — used in the loan table.
 *   - `long`              — `"68 days"` — used in the summary card.
 *
 * `null | undefined` → `"—"` in both variants.
 */
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

/**
 * Formats an estimated wait duration string for the Withdrawal Queue panel.
 *
 * The API returns `estimated_wait_days` as a 1-decimal string (e.g. `"3.2"`)
 * or `null` when the estimate is unavailable.
 *
 * - `"3.2"`  → `"~3.2 days"`
 * - `"1.0"`  → `"~1.0 days"`
 * - `null`   → `"—"`
 * - non-numeric string → `"—"`
 */
export function formatEstimatedWaitDays(
  days: string | null | undefined,
): string {
  if (days == null) return "—";
  const num = parseFloat(days);
  if (!Number.isFinite(num)) return "—";
  return `~${num.toFixed(1)} days`;
}

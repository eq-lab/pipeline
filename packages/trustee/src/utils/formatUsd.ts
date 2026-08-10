/**
 * Trustee-local money formatters for the Overview page's Capital Allocation
 * card (issue #797), extended by the Origination page (issue #813) and the
 * Loans page (issue #843).
 *
 * The trustee app deliberately does NOT depend on `@pipeline/frontend` (epic
 * #775 keeps the two apps separate), so these are self-contained ports of the
 * LP frontend's money formatters (`packages/frontend/src/utils/formatCompactUsd.ts`
 * for compact notation, `packages/frontend/src/lib/usdc.ts` for whole-dollar).
 * See `docs/exec-plans/tech-debt-tracker.md` for the cross-package
 * consolidation debt this duplication creates.
 *
 * Both formatters take base-6 decimal strings that are already in *human*
 * units (e.g. `"96000000.000000"` = $96,000,000) — this is the shape
 * `GET /v1/capital-allocation` serves (`base6_to_decimal_string` on the
 * backend). Do not pass raw sub-unit bigints.
 */

// ── formatCompactUsd ─────────────────────────────────────────────────────────

/**
 * Formats a base-6 decimal-string USD amount as compact notation, matching
 * the Figma legend precision (`$96M`, `$8.4M`, `$4.95M`, `$4.64M`, `$1.2M`) —
 * up to 2 significant decimal digits with trailing zeros trimmed, rather than
 * a fixed decimal count.
 *
 * - `"96000000.000000"` → `"$96M"`
 * - `"8400000.000000"`  → `"$8.4M"`
 * - `"4950000.000000"`  → `"$4.95M"`
 * - `"500000.000000"`   → `"$500K"`
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

  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    return `${sign}$${trimDecimals(abs / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${trimDecimals(abs / 1_000)}K`;
  }
  return `${sign}$${trimDecimals(abs)}`;
}

/**
 * Rounds to 2 decimal places and trims trailing zeros (and a trailing "."),
 * so `96` stays `"96"`, `8.4` stays `"8.4"`, and `4.95` stays `"4.95"`.
 */
function trimDecimals(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

// ── formatCompactUsd2dp ───────────────────────────────────────────────────────

/**
 * Compact USD like `formatCompactUsd`, but with a FIXED two decimal places
 * (trailing zeros kept) — the Loans-page table style (`$2.10M`, `$1.49M`,
 * `$1.84M`, `$1.26M`, issue #843). Distinct from `formatCompactUsd`, which
 * trims trailing zeros for the tighter Capital-Allocation legend precision
 * (`$96M`, `$8.4M`).
 *
 * - `"2100000.000000"` → `"$2.10M"`
 * - `"1490000.000000"` → `"$1.49M"`
 * - `"500000.000000"`  → `"$500.00K"`
 * - `"0.000000"`       → `"$0.00"`
 * - `null | undefined` → `"—"`
 * - non-numeric input  → `"—"`
 */
export function formatCompactUsd2dp(
  base6Decimal: string | null | undefined,
): string {
  if (base6Decimal == null) return "—";
  const num = parseFloat(base6Decimal);
  if (!Number.isFinite(num)) return "—";

  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

// ── formatFullUsd ─────────────────────────────────────────────────────────────

/**
 * Formats a base-6 decimal-string USD amount as fully-expanded whole dollars
 * with thousands separators, for the Capital Allocation card's big total.
 *
 * - `"115190000.000000"` → `"$115,190,000"`
 * - `"0.000000"`         → `"$0"`
 * - `null | undefined`   → `"—"`
 * - non-numeric input    → `"—"`
 */
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

/**
 * Formats a USD text-input value as-you-type with `,` thousands grouping
 * (issue #1048): keeps digits and the first decimal point, drops everything
 * else (`$`, stray separators, letters), and regroups the integer part.
 *
 * - `"45000"`        → `"45,000"`
 * - `"$1,234,567.89"`→ `"1,234,567.89"`
 * - `"45,000."`      → `"45,000."` (trailing point preserved mid-typing)
 * - `"abc"`          → `""`
 */
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

/**
 * Formats a rate expressed in **basis points** (the form the loan-submissions
 * API serves `senior_interest_rate_bps` in, issue #813) as a one-decimal
 * percentage. Mirrors the LP frontend's `formatBpsRate`
 * (`packages/frontend/src/utils/formatCompactUsd.ts`).
 *
 * This is a unit format of a directly-served value — no metric is derived.
 *
 * - `1400` → `"14.0%"`
 * - `0`    → `"0.0%"`
 * - `null | undefined` → `"—"`
 * - non-finite input   → `"—"`
 */
export function formatBpsRate(bps: number | null | undefined): string {
  if (bps == null) return "—";
  if (!Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

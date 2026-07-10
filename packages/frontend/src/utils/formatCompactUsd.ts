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

// ── scaleRegistryAmount ───────────────────────────────────────────────────────

/**
 * ⚠️ TEMPORARY WORKAROUND for issue #840 — REMOVE once the backend is fixed.
 *
 * The Stellar loan-registry stores economics amounts at **1e3 scale** (a
 * `$1.2M` facility is `1_200_000_000` on-chain — see the `draw_loan` encoding,
 * issue #831). Several backend surfaces read those back and serve them as if
 * they were plain 6-decimal USDC, so they arrive **1000× too small**
 * (`"1200.000000"` instead of `"1200000.000000"`). Confirmed (#841) on:
 *   - loan-book `principal` / `total_deployed`
 *   - `GET /v1/financial-position` → `assets.deployed.secured_loans_outstanding`
 *   - `GET /v1/dashboard/summary` → `outstanding_in_loans`
 *
 * The proper fix is backend (#840). Until it lands, this is the shared ×1000
 * core: scale the raw base-6 decimal string **at the source**, before it is
 * formatted, summed into a total, or used in a ratio — so every downstream
 * consumer (display string, aggregation, progress-bar ratio) sees a
 * consistent, already-correct value. **When #840 is fixed, delete this
 * helper and all its call sites** — otherwise amounts will render 1000×
 * too BIG.
 *
 * Apply ONLY to registry-economics amounts. Do NOT apply to `collateral` /
 * `total_collateral` (price feed, #706) or `tvl` / `accrued_interest_receivable`
 * (already correct scale) — those are different, already-correct sources.
 *
 * @returns the scaled base-6 decimal string, or `null` for null/undefined/
 *   non-finite input (passthrough — callers decide how to render "missing").
 */
export function scaleRegistryAmount(
  base6Decimal: string | null | undefined,
): string | null {
  if (base6Decimal == null) return null;
  const num = parseFloat(base6Decimal);
  if (!Number.isFinite(num)) return null;
  return (num * 1000).toFixed(6);
}

// ── formatRegistryCompactUsd ──────────────────────────────────────────────────

/**
 * ⚠️ TEMPORARY WORKAROUND for issue #840 — REMOVE once the backend is fixed.
 *
 * Compact-formats a registry-sourced amount after applying the ×1000
 * `scaleRegistryAmount` correction. See that function's doc comment for the
 * full rationale. **When #840 is fixed, delete this helper and revert the
 * call sites to `formatCompactUsd`.**
 *
 * Apply ONLY to registry-economics amounts (`principal`, `total_deployed`).
 * Do NOT use it for `collateral`/`total_collateral` — those come from the
 * price feed (#706), a different (already-correct) scale.
 */
export function formatRegistryCompactUsd(
  base6Decimal: string | null | undefined,
): string {
  return formatCompactUsd(scaleRegistryAmount(base6Decimal) ?? undefined);
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

// ── formatBpsRate ─────────────────────────────────────────────────────────────

/**
 * Formats a rate expressed in **basis points** (the form the loan-submissions
 * API serves `senior_interest_rate_bps` in) as a one-decimal percentage.
 *
 * This is a unit format of a directly-served value — no metric is derived.
 *
 * - `1120` → `"11.2%"`
 * - `1170` → `"11.7%"`
 * - `0`    → `"0.0%"`
 * - `null` → `"—"`
 */
export function formatBpsRate(bps: number | null | undefined): string {
  if (bps == null) return "—";
  if (!Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

// ── formatFullUsd ─────────────────────────────────────────────────────────────

/**
 * Formats a base-6 decimal-string USD amount as fully-expanded whole dollars
 * with thousands separators — used by the In-Origination table's Facility
 * column (issue #814, Figma node `4116-9155`), which shows the full amount
 * rather than the table's usual compact notation (`formatCompactUsd`).
 *
 * Hand-mirrored, byte-for-byte, from the trustee app's
 * `packages/trustee/src/utils/formatUsd.ts::formatFullUsd` (issue #813) — the
 * two apps stay separate per epic #775, so this is a deliberate duplicate,
 * not a shared import. See TD-42 (`docs/exec-plans/tech-debt-tracker.md`).
 *
 * - `"3500000.000000"` → `"$3,500,000"`
 * - `"0.000000"`        → `"$0"`
 * - `null | undefined`  → `"—"`
 * - non-numeric input   → `"—"`
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

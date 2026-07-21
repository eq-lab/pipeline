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

// ── scaleRegistryAmount ───────────────────────────────────────────────────────

/**
 * ⚠️ #840 PERMANENT WORKAROUND — #840 is CLOSED won't-fix ("no backend scale
 * change planned"), so this ×1000 correction is durable, client-side
 * behaviour, not a stopgap awaiting a backend fix.
 *
 * The Stellar loan-registry stores economics amounts at **1e3 scale** (a
 * `$1.2M` facility is `1_200_000_000` on-chain — see the `draw_loan` encoding,
 * issue #831). Several backend surfaces read those back and serve them as if
 * they were plain 6-decimal USDC, so they arrive **1000× too small**
 * (`"1200.000000"` instead of `"1200000.000000"`). Confirmed (#841) on
 * `GET /v1/loan-book`'s registry-sourced amounts (`summary.deployed_senior`,
 * `summary.at_risk_wl_and_default_senior`, per-loan `senior_outstanding`) —
 * the Trustee Loans page (issue #843) — and, per a live-payload audit
 * (issue #888), on `collateral` / `total_collateral` too: issue #843's
 * assumption that collateral was price-feed correct-scale was FALSE — it is
 * registry-sourced and 1000× too small on the same basis as
 * `senior_outstanding`.
 *
 * Hand-mirrored, byte-for-byte, from the LP frontend's
 * `packages/frontend/src/utils/formatCompactUsd.ts::scaleRegistryAmount`
 * (issue #842) — the two apps stay separate per epic #775, so this is a
 * deliberate duplicate, not a shared import. See TD-42
 * (`docs/exec-plans/tech-debt-tracker.md`).
 *
 * This is the shared ×1000 core: scale the raw base-6 decimal string **at the
 * source**, before it is formatted, summed into a total, or used in a ratio —
 * so every downstream consumer (display string, aggregation, progress-bar
 * ratio) sees a consistent, already-correct value.
 *
 * Apply to registry-economics amounts, INCLUDING `collateral` /
 * `total_collateral` (issue #888 — do NOT skip these). Do NOT apply to
 * `ccr_bps` (already correct as served — both its numerator and denominator
 * are registry-sourced 1000×-low amounts, so the ×1000 cancels out of the
 * ratio, see the Loans page's `-useLoansTable.ts`), `ltv` /
 * `at_risk_wl_and_default_pct` / `top_concentration.share` (same
 * scale-invariant-ratio reasoning), or `tvl` / `accrued_interest_receivable`
 * (already correct scale, not registry-derived).
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

// ── formatRegistryCompactUsd / formatRegistryCompact2dpUsd ────────────────────

/**
 * ⚠️ #840 permanent workaround (won't-fix — see `scaleRegistryAmount`'s doc
 * comment).
 *
 * Compact-formats a registry-sourced amount after applying the ×1000
 * `scaleRegistryAmount` correction. See that function's doc comment for the
 * full rationale.
 *
 * Apply to registry-economics amounts (Loans page summary cards:
 * `deployed_senior`, `at_risk_wl_and_default_senior`, `total_collateral`
 * — issue #888).
 */
export function formatRegistryCompactUsd(
  base6Decimal: string | null | undefined,
): string {
  return formatCompactUsd(scaleRegistryAmount(base6Decimal) ?? undefined);
}

/**
 * ⚠️ #840 permanent workaround (won't-fix — see `scaleRegistryAmount`'s doc
 * comment).
 *
 * Two-decimal compact form of a registry-sourced amount after applying the
 * ×1000 `scaleRegistryAmount` correction — the Loans page's "Senior outst."
 * and "Collateral" column style (`formatCompactUsd2dp`, e.g. `$1.84M`)
 * applied to a registry-sourced amount (`senior_outstanding`, `collateral`
 * — issue #888). See `scaleRegistryAmount`'s doc comment for the full
 * rationale.
 */
export function formatRegistryCompact2dpUsd(
  base6Decimal: string | null | undefined,
): string {
  return formatCompactUsd2dp(scaleRegistryAmount(base6Decimal) ?? undefined);
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

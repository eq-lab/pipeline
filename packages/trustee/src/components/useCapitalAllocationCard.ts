/**
 * Query-wiring + value→display mapping for `CapitalAllocationCard` (issue #797).
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` component is
 * JSX/styling only; this hook owns the `useCapitalAllocation` call and maps
 * the raw response into display-ready strings so the view stays a pure
 * render function (and this mapping is unit-testable without a DOM).
 *
 * ## Capital Wallet on-chain fold-in (issue #805)
 *
 * The Capital Wallet bucket is additionally sourced from
 * `useCapitalWalletBalance()` — a direct on-chain USDC-custody read — as an
 * interim substitute for the backend `capital_wallet` bucket (still `null`
 * until `capital_allocation.rs` indexes it; see TD-41). Precedence and the
 * guarded total sum (human-approved, issue #805):
 *
 *   - **Legend value**: prefer the backend `buckets.capital_wallet` when
 *     non-null (avoids stale on-chain data once the backend catches up);
 *     otherwise use the on-chain balance; otherwise `—`.
 *   - **Total**: `data.total` already includes `capital_wallet` once the
 *     backend sources it, so the on-chain balance is added ONLY while
 *     `buckets.capital_wallet` is `null` — a double-count guard. If backend
 *     `total` is `null` but the on-chain balance is known, the on-chain value
 *     is shown as the sole known total (real data, not fabricated); `—` only
 *     when neither source has anything.
 *   - This is a deliberate, documented, guarded EXCEPTION to [no
 *     frontend-computed metrics] — an interim client-side sum of two
 *     authoritative real sources, not a derived/estimated metric. Remove once
 *     the backend serves `capital_wallet` (the guard already prefers it).
 *   - A read error/loading/unset-id on the on-chain source degrades ONLY the
 *     Capital-Wallet legend value (and the total's extra addend) to "—" /
 *     backend-only; it does NOT drive the card's overall `isError`/`isLoading`
 *     — only the backend `useCapitalAllocation` query does that (keeps the
 *     card resilient to a flaky RPC).
 *
 * ## Per-bucket percentage pills (Figma node `4116:8961`, human-requested
 * scope addition to #805)
 *
 * Each legend row also shows `bucket_value ÷ displayed_total`, rounded to the
 * nearest whole percent, using the SAME guarded total described above (human
 * units, post on-chain fold-in). This is a deliberate, **explicitly
 * requested** reversal of #797's "no client-computed percentages" deferral
 * (TD-39) — the requester decided the on-chain-augmented total is now
 * authoritative enough to divide by. Documented alongside the total-sum
 * exception in `docs/exec-plans/tech-debt-tracker.md` TD-41.
 *   - A `null`/absent bucket renders NO percentage (`percentDisplay: null` →
 *     the view shows no pill) — never a fabricated `0%`.
 *   - Percentages are NOT normalized to sum to 100; independent per-bucket
 *     rounding may total 99% or 101%, matching the Figma reference.
 */
import { useCapitalAllocation } from "@/api/useCapitalAllocation";
import { useCapitalWalletBalance } from "@/api/useCapitalWalletBalance";
import { formatCompactUsd, formatFullUsd } from "@/utils/formatUsd";

/** One row of the Capital Allocation legend. */
export interface AllocationLegendRow {
  key: string;
  label: string;
  /** Formatted compact USD value, or "—" when the bucket is null. */
  value: string;
  /** CSS color value for the legend dot / bar segment (see component docs for token mapping). */
  color: string;
  /**
   * `"N%"` of the displayed total (rounded to the nearest whole percent), or
   * `null` when the bucket is null/absent or the total is unknown — the view
   * renders no pill in that case (never a fabricated `0%`). See the
   * "Per-bucket percentage pills" docs above.
   */
  percentDisplay: string | null;
}

export interface UseCapitalAllocationCardResult {
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  /** Fully-expanded whole-dollar total, e.g. "$115,190,000"; "—" when null. */
  totalDisplay: string;
  /** Five legend rows in Figma order: Capital Wallet, In transit, Trust account, Deployed, T-Bills (USYC). */
  legend: AllocationLegendRow[];
}

/**
 * Computes the guarded displayed total per issue #805's human-confirmed rule,
 * as a plain number (not yet formatted) — `undefined` when nothing is known.
 * All arithmetic happens on `parseFloat` of the base-6-human-unit strings
 * (the on-chain balance is pre-scaled to the same shape by
 * `useCapitalWalletBalance`).
 */
function computeTotalNum(
  backendTotal: string | null | undefined,
  backendCapitalWallet: string | null | undefined,
  onChainCapitalWallet: string | undefined,
): number | undefined {
  const backendTotalNum =
    backendTotal != null ? parseFloat(backendTotal) : undefined;
  const onChainNum =
    onChainCapitalWallet != null ? parseFloat(onChainCapitalWallet) : undefined;
  const backendHasCapitalWallet = backendCapitalWallet != null;

  if (backendTotalNum !== undefined && Number.isFinite(backendTotalNum)) {
    if (
      !backendHasCapitalWallet &&
      onChainNum !== undefined &&
      Number.isFinite(onChainNum)
    ) {
      // Double-count guard: only add the on-chain balance while the backend
      // has not yet indexed capital_wallet itself.
      return backendTotalNum + onChainNum;
    }
    // Backend total already reflects capital_wallet (or the on-chain read is
    // unavailable) — use it as-is.
    return backendTotalNum;
  }

  // Backend total is null. If the on-chain balance is the only known real
  // component, show it as the sole known total (issue #805 Open Question Q2,
  // resolved) — never fabricate, but do surface real data we have.
  if (onChainNum !== undefined && Number.isFinite(onChainNum)) {
    return onChainNum;
  }

  return undefined;
}

/**
 * Formats a guarded total number (from `computeTotalNum`) via `formatFullUsd`,
 * which expects a decimal string — "—" when `totalNum` is `undefined`.
 */
function formatTotalDisplay(totalNum: number | undefined): string {
  return formatFullUsd(totalNum !== undefined ? String(totalNum) : undefined);
}

/**
 * Computes a legend row's `"N%"` of the displayed total, rounded to the
 * nearest whole percent — `null` when the bucket value is null/absent or the
 * total is unknown/zero (never a fabricated `0%`). Figma node `4116:8961`.
 */
function computePercentDisplay(
  bucketValue: string | null | undefined,
  totalNum: number | undefined,
): string | null {
  if (bucketValue == null || totalNum === undefined || totalNum === 0) {
    return null;
  }
  const bucketNum = parseFloat(bucketValue);
  if (!Number.isFinite(bucketNum)) return null;
  return `${Math.round((bucketNum / totalNum) * 100)}%`;
}

export function useCapitalAllocationCard(): UseCapitalAllocationCardResult {
  const { data, isLoading, error } = useCapitalAllocation();
  const { data: onChainCapitalWallet } = useCapitalWalletBalance();

  // Capital Wallet legend value: prefer the backend bucket when non-null
  // (avoids showing stale on-chain data once the backend catches up);
  // otherwise fall back to the on-chain read; otherwise "—". The same
  // precedence applies to the value used for the percentage pill.
  const effectiveCapitalWallet =
    data?.buckets.capital_wallet ?? onChainCapitalWallet;

  const totalNum = computeTotalNum(
    data?.total,
    data?.buckets.capital_wallet,
    onChainCapitalWallet,
  );

  const legend: AllocationLegendRow[] = [
    {
      key: "capital_wallet",
      label: "Capital Wallet",
      value: formatCompactUsd(effectiveCapitalWallet),
      // Figma #000080 — exact match for --color-pipeline-brand.
      color: "var(--color-pipeline-brand)",
      percentDisplay: computePercentDisplay(effectiveCapitalWallet, totalNum),
    },
    {
      key: "in_transit",
      label: "In transit",
      value: formatCompactUsd(data?.buckets.in_transit),
      // Figma #c9a200 — no matching token; scoped one-off (SignInCard/#786 precedent).
      color: "#c9a200",
      percentDisplay: computePercentDisplay(data?.buckets.in_transit, totalNum),
    },
    {
      key: "trust_account",
      label: "Trust account",
      value: formatCompactUsd(data?.buckets.trust_account),
      // Figma rgba(56,55,53,0.35) — a darker alpha step of --color-pipeline-ink
      // than any existing muted/subtle token; scoped one-off.
      color: "rgba(56, 55, 53, 0.35)",
      percentDisplay: computePercentDisplay(
        data?.buckets.trust_account,
        totalNum,
      ),
    },
    {
      key: "deployed",
      label: "Deployed",
      value: formatCompactUsd(data?.buckets.deployed),
      // Figma #208000 — exact match for --color-pipeline-positive-primary.
      color: "var(--color-pipeline-positive-primary)",
      percentDisplay: computePercentDisplay(data?.buckets.deployed, totalNum),
    },
    {
      key: "tbills",
      label: "T-Bills (USYC)",
      value: formatCompactUsd(data?.buckets.tbills),
      // Figma #6666b3 — no matching token; scoped one-off (SignInCard/#786 precedent).
      color: "#6666b3",
      percentDisplay: computePercentDisplay(data?.buckets.tbills, totalNum),
    },
  ];

  return {
    isLoading,
    // Only the backend query's error drives the card-level error surface —
    // a flaky on-chain read degrades just the Capital-Wallet legend value.
    isError: error !== null,
    errorMessage: error?.message ?? null,
    totalDisplay: formatTotalDisplay(totalNum),
    legend,
  };
}

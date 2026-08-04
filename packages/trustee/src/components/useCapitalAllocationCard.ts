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
 *   - A `null`/absent bucket, an unknown total, or a `<= 0` share renders NO
 *     percentage (`percentDisplay: null` → the view shows no pill) — never a
 *     fabricated `0%`.
 *   - A strictly-positive share under 1% renders `"< 1%"` (human review
 *     follow-up on PR #811) — NOT rounded down to `"0%"` and NOT rounded up to
 *     `"1%"`. `pct >= 1` rounds to the nearest whole percent as before.
 *   - Percentages are NOT normalized to sum to 100; independent per-bucket
 *     rounding may total 99% or 101%, matching the Figma reference.
 *
 * ## Proportional allocation bar (human review follow-up on #805, PR #811)
 *
 * Each legend row also carries `barFraction` — the EXACT (unrounded) share of
 * the displayed total, in `[0, 1]`. `CapitalAllocationCard.tsx` uses this to
 * size each bar segment's width, so the bar now visually matches the legend
 * percentages (superseding #797/TD-39's inert equal-width placeholder bar for
 * buckets with a known value). A `null` `barFraction` (bucket/total unknown)
 * renders NO segment for that bucket — same "nothing known" conditions as
 * `percentDisplay`, but using the raw fraction (not the rounded/`"< 1%"`
 * display text) so segments sum to ~100% rather than drifting from rounding.
 * Folded into TD-41 alongside the total-sum and percentage-pill exceptions —
 * all three are the same category of guarded, documented, explicitly
 * requested client-side arithmetic over real sources.
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
   * `"N%"` of the displayed total (rounded to the nearest whole percent),
   * `"< 1%"` for a strictly-positive sub-1%-share bucket, or `null` when the
   * bucket is null/absent, the total is unknown, or the share is `<= 0` — the
   * view renders no pill in that case (never a fabricated `0%`). See the
   * "Per-bucket percentage pills" docs above.
   */
  percentDisplay: string | null;
  /**
   * EXACT (unrounded) share of the displayed total in `[0, 1]`, for the
   * allocation bar's proportional segment width — `null` under the same
   * "nothing known" conditions as `percentDisplay` (renders no segment).
   * Distinct from `percentDisplay`: the bar needs the raw fraction (segments
   * sum to ~100%), not the rounded/`"< 1%"` display text.
   */
  barFraction: number | null;
}

export interface UseCapitalAllocationCardResult {
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  /** Fully-expanded whole-dollar total, e.g. "$115,190,000"; "—" when null. */
  totalDisplay: string;
  /**
   * Six legend rows: Capital Wallet, In transit, Trust account, Withdrawal
   * queue, Deployed, T-Bills (USYC) — the Figma's five buckets plus the
   * `withdrawal_queue` bucket the backend added later (#933, rendered per
   * #1020).
   */
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
 * Computes a legend row's percentage of the displayed total — `null` when the
 * bucket value is null/absent, the total is unknown/zero, or the computed
 * percentage is non-finite or `<= 0` (never a fabricated `0%`). Figma node
 * `4116:8961`.
 *
 * Human review feedback on #805 (PR #811, addressed as a follow-up fix): a
 * bucket whose share is strictly between 0 and 1 percent must render `"< 1%"`
 * — NOT rounded down to `"0%"` (would look like nothing) and NOT rounded up
 * to `"1%"` (would overstate a tiny bucket). `pct >= 1` still rounds to the
 * nearest whole percent as before.
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

  const pct = (bucketNum / totalNum) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  if (pct < 1) return "< 1%";
  return `${Math.round(pct)}%`;
}

/**
 * Computes a legend row's EXACT (unrounded) share of the displayed total, as
 * a fraction in `[0, 1]` — used for the bar segment's proportional width
 * (Figma allocation bar, review follow-up on #805/PR #811). Distinct from
 * `computePercentDisplay`'s rounded/`"< 1%"` text: the bar must sum to ~100%
 * across segments, so it uses the raw fraction, not the rounded display
 * string. `null` under the same "nothing known" conditions as the percent
 * pill — the bar renders no segment for that bucket.
 */
function computeBarFraction(
  bucketValue: string | null | undefined,
  totalNum: number | undefined,
): number | null {
  if (bucketValue == null || totalNum === undefined || totalNum === 0) {
    return null;
  }
  const bucketNum = parseFloat(bucketValue);
  if (!Number.isFinite(bucketNum)) return null;

  const fraction = bucketNum / totalNum;
  if (!Number.isFinite(fraction) || fraction <= 0) return null;
  return fraction;
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
      barFraction: computeBarFraction(effectiveCapitalWallet, totalNum),
    },
    {
      key: "in_transit",
      label: "In transit",
      value: formatCompactUsd(data?.buckets.in_transit),
      // Figma #c9a200 — no matching token; scoped one-off (SignInCard/#786 precedent).
      color: "#c9a200",
      percentDisplay: computePercentDisplay(data?.buckets.in_transit, totalNum),
      barFraction: computeBarFraction(data?.buckets.in_transit, totalNum),
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
      barFraction: computeBarFraction(data?.buckets.trust_account, totalNum),
    },
    {
      key: "withdrawal_queue",
      label: "Withdrawal queue",
      value: formatCompactUsd(data?.buckets.withdrawal_queue),
      // Not in the Figma frame (the bucket postdates it, #933/#1020) — a
      // distinct scoped one-off alongside the other non-token legend colors.
      color: "#3d8f8f",
      percentDisplay: computePercentDisplay(
        data?.buckets.withdrawal_queue,
        totalNum,
      ),
      barFraction: computeBarFraction(data?.buckets.withdrawal_queue, totalNum),
    },
    {
      key: "deployed",
      label: "Deployed",
      value: formatCompactUsd(data?.buckets.deployed),
      // Figma #208000 — exact match for --color-pipeline-positive-primary.
      color: "var(--color-pipeline-positive-primary)",
      percentDisplay: computePercentDisplay(data?.buckets.deployed, totalNum),
      barFraction: computeBarFraction(data?.buckets.deployed, totalNum),
    },
    {
      key: "tbills",
      label: "T-Bills (USYC)",
      value: formatCompactUsd(data?.buckets.tbills),
      // Figma #6666b3 — no matching token; scoped one-off (SignInCard/#786 precedent).
      color: "#6666b3",
      percentDisplay: computePercentDisplay(data?.buckets.tbills, totalNum),
      barFraction: computeBarFraction(data?.buckets.tbills, totalNum),
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

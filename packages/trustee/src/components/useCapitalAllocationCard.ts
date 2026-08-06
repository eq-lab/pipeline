/**
 * Query-wiring + value→display mapping for `CapitalAllocationCard`.
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` component is
 * JSX/styling only; this hook owns the `useCapitalAllocation` call and maps
 * the raw response into display-ready strings so the view stays a pure
 * render function (and this mapping is unit-testable without a DOM).
 *
 * spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer
 * (on-chain fold-in, guarded total, percentage pills, allocation bar — all
 * TD-41).
 */
import { useCapitalAllocation } from "@/api/useCapitalAllocation";
import { useCapitalWalletBalance } from "@/api/useCapitalWalletBalance";
import { formatCompactUsd, formatFullUsd } from "@/utils/formatUsd";
import { toUserError } from "@/utils/userError";

/** One row of the Capital Allocation legend. */
export interface AllocationLegendRow {
  key: string;
  label: string;
  /** Formatted compact USD value, or "—" when the bucket is null. */
  value: string;
  /** CSS color value for the legend dot / bar segment (see component docs for token mapping). */
  color: string;
  /** `"N%"` / `"< 1%"` / `null` — see spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer. */
  percentDisplay: string | null;
  /** Exact unrounded share in `[0, 1]`, for the bar's proportional segment width. */
  barFraction: number | null;
}

export interface UseCapitalAllocationCardResult {
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  errorDetails: string | null;
  /** Fully-expanded whole-dollar total, e.g. "$115,190,000"; "—" when null. */
  totalDisplay: string;
  /** Six legend rows — see spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer. */
  legend: AllocationLegendRow[];
}

// spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer (guarded total).
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
    return backendTotalNum;
  }

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

// spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer (percentage pills).
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

// spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer (allocation bar).
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

  const mapped = error
    ? toUserError(error, "Failed to load Capital Allocation data.")
    : null;

  return {
    isLoading,
    // Only the backend query's error drives the card-level error surface —
    // a flaky on-chain read degrades just the Capital-Wallet legend value.
    isError: error !== null,
    errorMessage: mapped?.message ?? null,
    errorDetails: mapped?.details ?? null,
    totalDisplay: formatTotalDisplay(totalNum),
    legend,
  };
}

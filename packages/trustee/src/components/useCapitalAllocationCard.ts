/**
 * Query-wiring + value→display mapping for `CapitalAllocationCard` (issue #797).
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` component is
 * JSX/styling only; this hook owns the `useCapitalAllocation` call and maps
 * the raw response into display-ready strings so the view stays a pure
 * render function (and this mapping is unit-testable without a DOM).
 */
import { useCapitalAllocation } from "@/api/useCapitalAllocation";
import { formatCompactUsd, formatFullUsd } from "@/utils/formatUsd";

/** One row of the Capital Allocation legend. */
export interface AllocationLegendRow {
  key: string;
  label: string;
  /** Formatted compact USD value, or "—" when the bucket is null. */
  value: string;
  /** CSS color value for the legend dot / bar segment (see component docs for token mapping). */
  color: string;
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

export function useCapitalAllocationCard(): UseCapitalAllocationCardResult {
  const { data, isLoading, error } = useCapitalAllocation();

  const legend: AllocationLegendRow[] = [
    {
      key: "capital_wallet",
      label: "Capital Wallet",
      value: formatCompactUsd(data?.buckets.capital_wallet),
      // Figma #000080 — exact match for --color-pipeline-brand.
      color: "var(--color-pipeline-brand)",
    },
    {
      key: "in_transit",
      label: "In transit",
      value: formatCompactUsd(data?.buckets.in_transit),
      // Figma #c9a200 — no matching token; scoped one-off (SignInCard/#786 precedent).
      color: "#c9a200",
    },
    {
      key: "trust_account",
      label: "Trust account",
      value: formatCompactUsd(data?.buckets.trust_account),
      // Figma rgba(56,55,53,0.35) — a darker alpha step of --color-pipeline-ink
      // than any existing muted/subtle token; scoped one-off.
      color: "rgba(56, 55, 53, 0.35)",
    },
    {
      key: "deployed",
      label: "Deployed",
      value: formatCompactUsd(data?.buckets.deployed),
      // Figma #208000 — exact match for --color-pipeline-positive-primary.
      color: "var(--color-pipeline-positive-primary)",
    },
    {
      key: "tbills",
      label: "T-Bills (USYC)",
      value: formatCompactUsd(data?.buckets.tbills),
      // Figma #6666b3 — no matching token; scoped one-off (SignInCard/#786 precedent).
      color: "#6666b3",
    },
  ];

  return {
    isLoading,
    isError: error !== null,
    errorMessage: error?.message ?? null,
    totalDisplay: formatFullUsd(data?.total),
    legend,
  };
}

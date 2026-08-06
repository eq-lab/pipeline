/**
 * Co-located hook for `YieldHistoryPanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * spec: docs/frontend/dashboard-components.md#yieldhistorypanel
 * (endpoints, chain-scoping decision, business rules for each field).
 */
import { ENV } from "@/lib/env";
import { useDashboardSummary } from "@/api/useDashboardSummary";
import { useDashboardTvlHistory } from "@/api/useDashboardTvlHistory";
import { useDashboardYieldHistory } from "@/api/useDashboardYieldHistory";
import { pointsToBars } from "@/utils/yieldSeries";
import {
  formatCompactUsd,
  formatOneDecimalRate,
} from "@/utils/formatCompactUsd";
import type { PanelState } from "./PanelContainer";
import type { YieldBarPoint } from "@/utils/yieldSeries";

// ── Output types ──────────────────────────────────────────────────────────────

/** spec: docs/frontend/dashboard-components.md#yieldhistorypanel (metric card sourcing) */
export interface YieldHistoryMetricCards {
  currentApyNet: string;
  loanBookYield: string;
  targetNetApy: string;
}

export interface TvlSummary {
  /** Formatted headline TVL, e.g. "$43.1M". "—" when null/empty. */
  headlineTvl: string;
  /** Formatted outstanding in loans, e.g. "$31.6M". "—" when null. */
  outstandingInLoans: string;
  /** Deployment ratio (0–1) for the progress bar, or `null` on divide-by-zero/missing data. */
  deployedRatio: number | null;
}

export interface YieldHistoryPanelState {
  state: PanelState;
  /** Pre-computed cumulative-yield bar array, or `null` when empty/loading. */
  cumulativeBars: YieldBarPoint[] | null;
  /** Formatted headline value (e.g. "$2.91M") for the Cumulative Yield card. */
  headlineValue: string;
  /** Pre-computed TVL bar array, or `null` when empty/loading. */
  tvlBars: YieldBarPoint[] | null;
  /** TVL card summary values (formatted). */
  tvlSummary: TvlSummary;
  /** The three metric card values. */
  metricCards: YieldHistoryMetricCards;
  errorMessage: string | undefined;
  /** Refetches all data sources. */
  refetch: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Static product constant — spec: docs/frontend/dashboard-components.md#yieldhistorypanel. Seam: #738.
const TARGET_NET_APY_STATIC = "8–12%";

// ── Fallback values ───────────────────────────────────────────────────────────

const EMPTY_METRICS: YieldHistoryMetricCards = {
  currentApyNet: "—",
  loanBookYield: "—",
  targetNetApy: TARGET_NET_APY_STATIC,
};

const EMPTY_TVL_SUMMARY: TvlSummary = {
  headlineTvl: "—",
  outstandingInLoans: "—",
  deployedRatio: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Drives `YieldHistoryPanel`.
 *
 * - `loading` → panel shows `PanelLoading`.
 * - `error`   → panel shows `PanelError` with a retry action.
 * - `empty`   → all series are empty and summary values are null/zero.
 * - `ready`   → derived headline + bar arrays + metric cards are available.
 */
export function useYieldHistoryPanel(): YieldHistoryPanelState {
  const chainId = ENV.STELLAR_CHAIN_ID;

  // ── Fetch all three dashboard endpoints ─────────────────────────────────────
  // The two series show full history at the default daily interval (no selector).

  const summaryQuery = useDashboardSummary();

  const tvlHistoryQuery = useDashboardTvlHistory({ chainId });

  const yieldHistoryQuery = useDashboardYieldHistory({ chainId });

  // Combine refetch for all queries
  const refetch = () => {
    summaryQuery.refetch();
    tvlHistoryQuery.refetch();
    yieldHistoryQuery.refetch();
  };

  // ── Loading ─────────────────────────────────────────────────────────────────
  // Show loading while summary or any series is loading.

  const isLoading =
    summaryQuery.isLoading ||
    tvlHistoryQuery.isLoading ||
    yieldHistoryQuery.isLoading;

  if (isLoading) {
    return {
      state: "loading",
      cumulativeBars: null,
      headlineValue: "—",
      tvlBars: null,
      tvlSummary: EMPTY_TVL_SUMMARY,
      metricCards: EMPTY_METRICS,
      errorMessage: undefined,
      refetch,
    };
  }

  // ── Error ───────────────────────────────────────────────────────────────────

  const primaryError =
    summaryQuery.error ?? tvlHistoryQuery.error ?? yieldHistoryQuery.error;
  if (primaryError) {
    return {
      state: "error",
      cumulativeBars: null,
      headlineValue: "—",
      tvlBars: null,
      tvlSummary: EMPTY_TVL_SUMMARY,
      metricCards: EMPTY_METRICS,
      errorMessage: primaryError.message,
      refetch,
    };
  }

  // ── Derive chart data ───────────────────────────────────────────────────────

  // Cumulative yield bars from yield-history series
  const cumulativeBars = pointsToBars(
    (yieldHistoryQuery.data ?? []).map((p) => ({
      timestamp: p.timestamp,
      value: p.cumulative_yield,
    })),
  );

  // TVL bars from tvl-history series
  const tvlBars = pointsToBars(
    (tvlHistoryQuery.data ?? []).map((p) => ({
      timestamp: p.timestamp,
      value: p.tvl,
    })),
  );

  // ── Headline value from summary ─────────────────────────────────────────────
  // spec: docs/frontend/dashboard-components.md#yieldhistorypanel (headline source)
  const summary = summaryQuery.data;

  const headlineValue = summary?.cumulative_yield_total
    ? formatCompactUsd(summary.cumulative_yield_total)
    : "—";

  // ── TVL summary ─────────────────────────────────────────────────────────────
  // outstanding_in_loans displayed as served (issue #906 — no frontend rescaling).
  const outstandingInLoansRaw = summary?.outstanding_in_loans ?? null;

  const headlineTvl = summary?.tvl ? formatCompactUsd(summary.tvl) : "—";
  const outstandingInLoans = formatCompactUsd(outstandingInLoansRaw);

  // Deployment ratio calc — spec: docs/frontend/dashboard-components.md#yieldhistorypanel
  let deployedRatio: number | null = null;
  if (summary?.tvl != null && outstandingInLoansRaw != null) {
    const tvlNum = parseFloat(summary.tvl);
    const outstandingNum = parseFloat(outstandingInLoansRaw);
    if (
      Number.isFinite(tvlNum) &&
      Number.isFinite(outstandingNum) &&
      tvlNum > 0
    ) {
      deployedRatio = outstandingNum / tvlNum;
    }
  }

  const tvlSummary: TvlSummary = {
    headlineTvl,
    outstandingInLoans,
    deployedRatio,
  };

  // ── Metric cards ────────────────────────────────────────────────────────────

  const currentApyNet = formatOneDecimalRate(
    summary?.current_apy_net_to_splusd ?? null,
  );
  const loanBookYield = formatOneDecimalRate(summary?.loan_book_yield ?? null);

  const metricCards: YieldHistoryMetricCards = {
    currentApyNet,
    loanBookYield,
    // TODO(#738): replace with live decomposed APY once the backend serves it.
    targetNetApy: TARGET_NET_APY_STATIC,
  };

  // ── Empty state when all series are empty and summary is null/zero ──────────

  const summaryAllNull =
    !summary ||
    (summary.cumulative_yield_total === "0.000000" &&
      !summary.outstanding_in_loans &&
      !summary.current_apy_net_to_splusd &&
      !summary.loan_book_yield);

  if (cumulativeBars === null && tvlBars === null && summaryAllNull) {
    return {
      state: "empty",
      cumulativeBars: null,
      headlineValue: "—",
      tvlBars: null,
      tvlSummary: EMPTY_TVL_SUMMARY,
      metricCards,
      errorMessage: undefined,
      refetch,
    };
  }

  // ── Ready ───────────────────────────────────────────────────────────────────

  return {
    state: "ready",
    cumulativeBars,
    headlineValue,
    tvlBars,
    tvlSummary,
    metricCards,
    errorMessage: undefined,
    refetch,
  };
}

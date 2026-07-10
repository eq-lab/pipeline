/**
 * Co-located hook for `YieldHistoryPanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * Resolves chain from ENV defaults (no wallet connection on the Protocol
 * Dashboard), fans out API calls to the three new `/v1/dashboard/*` endpoints,
 * and derives panel state + formatted values for the view layer.
 *
 * Endpoints used (issue #760):
 *   - `GET /v1/dashboard/summary?chain_id` — five headline KPIs
 *   - `GET /v1/dashboard/tvl-history?chain_id&days&interval` — TVL series
 *   - `GET /v1/dashboard/yield-history?chain_id&days&interval` — yield series
 *
 * Decisions (issue #760):
 *   - `chainId` = ENV.STELLAR_CHAIN_ID — the Protocol Dashboard is Stellar-scoped
 *     (real data on chain 99000001; the EVM chain carries malformed test data, #765).
 *   - All three endpoints are protocol-level (no vault address needed).
 *     The zero-address vault guard from the pre-#760 version has been dropped —
 *     these endpoints are unconditionally enabled (they are wallet-less and
 *     the panel's empty state handles `200 []`).
 *   - "Target Net to sPLUSD" is a static product constant ("8–12%") — no
 *     endpoint serves a target APY yet (#738 backend follow-up); the value is
 *     fixed in the Figma spec and product docs.
 *   - "Current APY, Net to sPLUSD" → `summary.current_apy_net_to_splusd`.
 *   - "Loan Book Yield" → `summary.loan_book_yield`.
 *   - Cumulative Yield headline → `summary.cumulative_yield_total`.
 *   - Progress bar fill → `outstanding_in_loans / tvl` (approved exception
 *     to "no frontend-computed metrics" for ratio-of-served-values; null/zero
 *     tvl → null, render empty bar + "—%").
 *   - ⚠️ #840/#841 workaround: `outstanding_in_loans` is registry-sourced and
 *     currently served 1000× too small. It is scaled via `scaleRegistryAmount`
 *     ONCE at the source (see `outstandingInLoansScaled` below) so the
 *     displayed value and the ratio above both use the corrected number.
 *     `tvl` is NOT scaled — it is already at the correct scale. Remove this
 *     workaround (and its call site) once #840 lands.
 */
import { ENV } from "@/lib/env";
import { useDashboardSummary } from "@/api/useDashboardSummary";
import { useDashboardTvlHistory } from "@/api/useDashboardTvlHistory";
import { useDashboardYieldHistory } from "@/api/useDashboardYieldHistory";
import { pointsToBars } from "@/utils/yieldSeries";
import {
  formatCompactUsd,
  formatOneDecimalRate,
  scaleRegistryAmount,
} from "@/utils/formatCompactUsd";
import type { PanelState } from "./PanelContainer";
import type { YieldBarPoint } from "@/utils/yieldSeries";

// ── Output types ──────────────────────────────────────────────────────────────

export interface YieldHistoryMetricCards {
  /**
   * Current APY, Net to sPLUSD — from `GET /v1/dashboard/summary`
   * `current_apy_net_to_splusd`. "—" when null.
   */
  currentApyNet: string;
  /**
   * Loan Book Yield — from `GET /v1/dashboard/summary` `loan_book_yield`.
   * "—" when no active loans or data is unavailable.
   */
  loanBookYield: string;
  /**
   * Target Net to sPLUSD — static product constant (8–12%). No endpoint
   * serves a target APY yet; seam left for #738.
   */
  targetNetApy: string;
}

export interface TvlSummary {
  /** Formatted headline TVL, e.g. "$43.1M". "—" when null/empty. */
  headlineTvl: string;
  /** Formatted outstanding in loans, e.g. "$31.6M". "—" when null. */
  outstandingInLoans: string;
  /**
   * Deployment ratio (0–1) for the progress bar, or `null` when
   * tvl is null/zero (divide-by-zero guard) or outstanding is null.
   */
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

/**
 * "Target Net to sPLUSD" is a static product constant (8–12%). No API endpoint
 * serves a target APY today — seam left for #738. Fixed in the Figma spec and docs.
 */
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
  // Headline comes from summary.cumulative_yield_total (not last chart bar),
  // so the KPI matches even when the chart resamples/aggregates.

  const summary = summaryQuery.data;

  const headlineValue = summary?.cumulative_yield_total
    ? formatCompactUsd(summary.cumulative_yield_total)
    : "—";

  // ── TVL summary ─────────────────────────────────────────────────────────────

  // #840 workaround — remove when backend scale fixed: `outstanding_in_loans`
  // is registry-sourced and arrives 1000× too small (issue #841). Scale it
  // ONCE here, at the source, so both the displayed value and the
  // progress-bar ratio below use the same corrected number. Do NOT scale
  // `tvl` — it is already at the correct scale.
  const outstandingInLoansScaled = scaleRegistryAmount(
    summary?.outstanding_in_loans ?? null,
  );

  const headlineTvl = summary?.tvl ? formatCompactUsd(summary.tvl) : "—";
  const outstandingInLoans = formatCompactUsd(outstandingInLoansScaled);

  // Deployment ratio — approved client-side computation (ratio of two served values).
  // Guard against null/zero tvl to avoid divide-by-zero.
  let deployedRatio: number | null = null;
  if (summary?.tvl != null && outstandingInLoansScaled != null) {
    const tvlNum = parseFloat(summary.tvl);
    const outstandingNum = parseFloat(outstandingInLoansScaled);
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

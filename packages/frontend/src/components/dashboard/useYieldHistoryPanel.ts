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
 *   - `chainId` = ENV.EVM_CHAIN_ID (EVM is canonical for the dashboard).
 *   - All three endpoints are protocol-level (no vault address needed).
 *     The zero-address vault guard from the pre-#760 version has been dropped —
 *     these endpoints are unconditionally enabled (they are wallet-less and
 *     the panel's empty state handles `200 []`).
 *   - "Target Net to sPLUSD" has no backing endpoint yet (#738 backend
 *     follow-up); it renders "—" until the backend serves it (surface only
 *     backend-served data).
 *   - "Current APY, Net to sPLUSD" → `summary.current_apy_net_to_splusd`.
 *   - "Loan Book Yield" → `summary.loan_book_yield`.
 *   - Cumulative Yield headline → `summary.cumulative_yield_total`.
 *   - Progress bar fill → `outstanding_in_loans / tvl` (approved exception
 *     to "no frontend-computed metrics" for ratio-of-served-values; null/zero
 *     tvl → null, render empty bar + "—%").
 */
import { useState } from "react";
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
   * Target Net to sPLUSD — no backing endpoint yet (#738). Renders "—"
   * until the backend serves a target APY field.
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
  /** Active time-range period id (default "all"). */
  periodId: string;
  setPeriodId: (id: string) => void;
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

// ── Fallback values ───────────────────────────────────────────────────────────

const EMPTY_METRICS: YieldHistoryMetricCards = {
  currentApyNet: "—",
  loanBookYield: "—",
  targetNetApy: "—",
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
  const [periodId, setPeriodId] = useState("all");

  const chainId = ENV.EVM_CHAIN_ID;

  // ── Fetch all three dashboard endpoints ─────────────────────────────────────

  const summaryQuery = useDashboardSummary();

  const tvlHistoryQuery = useDashboardTvlHistory({
    chainId,
    periodId,
  });

  const yieldHistoryQuery = useDashboardYieldHistory({
    chainId,
    periodId,
  });

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
      periodId,
      setPeriodId,
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
      periodId,
      setPeriodId,
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

  const headlineTvl = summary?.tvl ? formatCompactUsd(summary.tvl) : "—";
  const outstandingInLoans = formatCompactUsd(
    summary?.outstanding_in_loans ?? null,
  );

  // Deployment ratio — approved client-side computation (ratio of two served values).
  // Guard against null/zero tvl to avoid divide-by-zero.
  let deployedRatio: number | null = null;
  if (summary?.tvl != null && summary?.outstanding_in_loans != null) {
    const tvlNum = parseFloat(summary.tvl);
    const outstandingNum = parseFloat(summary.outstanding_in_loans);
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
    // TODO(#738): wire live target APY when the backend serves it; "—" until then.
    targetNetApy: "—",
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
      periodId,
      setPeriodId,
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
    periodId,
    setPeriodId,
    cumulativeBars,
    headlineValue,
    tvlBars,
    tvlSummary,
    metricCards,
    errorMessage: undefined,
    refetch,
  };
}

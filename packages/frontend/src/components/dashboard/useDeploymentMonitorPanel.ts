/**
 * Co-located hook for `DeploymentMonitorPanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * Maps raw `useLoanBook` data → formatted summary cards + table rows + panel
 * state, so the view layer is pure JSX with no formatting logic.
 */
import { useLoanBook } from "@/api";
import type { LoanBookSummary, LoanBookEntry } from "@/api";
import type { PanelState } from "./PanelContainer";
import type { LoanBookSummaryProps } from "./LoanBookSummary";
import type { LoanBookRow, LoanBookHeaderAggregates } from "./LoanBookTable";
import {
  formatCompactUsd,
  formatOneDecimalRate,
  formatLtv,
  formatCoverage,
  formatDurationDays,
} from "@/utils/formatCompactUsd";

// ── Formatted output types ────────────────────────────────────────────────────

export interface DeploymentMonitorPanelState {
  state: PanelState;
  summary: LoanBookSummaryProps;
  rows: LoanBookRow[];
  /**
   * Pre-formatted aggregate strings for the table column headers.
   * Populated from `summary` by the hook (FRONTEND.md rule 2: formatting
   * lives in the hook, not in the table component).
   *
   * - `principal` — always defined when ready (total_deployed is non-null).
   * - `collateral` — defined only when `total_collateral` is non-null; `undefined`
   *   while TODO #706 (commodity price feed) is not yet merged.
   * - LTV subtitle is intentionally omitted until a backend `portfolio_ltv`
   *   field exists (resolved open question — do NOT compute LTV client-side).
   */
  headerAggregates: LoanBookHeaderAggregates;
  /** Live count of active loans (loans.length when ready; 0 otherwise). */
  activeLoansCount: number;
  errorMessage: string | undefined;
  refetch: () => void;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatSummary(summary: LoanBookSummary): LoanBookSummaryProps {
  return {
    totalDeployed: formatCompactUsd(summary.total_deployed),
    totalCollateral: formatCompactUsd(summary.total_collateral),
    seniorDebtCoverage: formatCoverage(summary.senior_debt_coverage),
    avgYield: formatOneDecimalRate(summary.avg_yield),
    avgDuration: formatDurationDays(summary.avg_duration_days, "long"),
  };
}

function formatRow(entry: LoanBookEntry): LoanBookRow {
  return {
    borrowerCommodity: `${entry.borrower} / ${entry.commodity}`,
    principal: formatCompactUsd(entry.principal),
    collateral: formatCompactUsd(entry.collateral),
    ltv: formatLtv(entry.ltv),
    duration: formatDurationDays(entry.duration_days, "compact"),
    rate: formatOneDecimalRate(entry.rate),
    protection: entry.protection ?? "—",
  };
}

// ── Empty summary fallback (all "—") ─────────────────────────────────────────

const EMPTY_SUMMARY: LoanBookSummaryProps = {
  totalDeployed: "—",
  totalCollateral: "—",
  seniorDebtCoverage: "—",
  avgYield: "—",
  avgDuration: "—",
};

/** No aggregates while loading / error / empty — headers render label-only. */
const EMPTY_HEADER_AGGREGATES: LoanBookHeaderAggregates = {};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Drives `DeploymentMonitorPanel`.
 *
 * - `loading` → panel shows `PanelLoading`.
 * - `error`   → panel shows `PanelError` with a retry action.
 * - `empty`   → no active loans; panel shows `PanelEmpty`.
 * - `ready`   → formatted summary + rows are available.
 */
export function useDeploymentMonitorPanel(): DeploymentMonitorPanelState {
  const { data, isLoading, error, refetch } = useLoanBook();

  if (isLoading) {
    return {
      state: "loading",
      summary: EMPTY_SUMMARY,
      headerAggregates: EMPTY_HEADER_AGGREGATES,
      rows: [],
      activeLoansCount: 0,
      errorMessage: undefined,
      refetch,
    };
  }

  if (error) {
    return {
      state: "error",
      summary: EMPTY_SUMMARY,
      headerAggregates: EMPTY_HEADER_AGGREGATES,
      rows: [],
      activeLoansCount: 0,
      errorMessage: error.message,
      refetch,
    };
  }

  if (!data || data.loans.length === 0) {
    return {
      state: "empty",
      summary: EMPTY_SUMMARY,
      headerAggregates: EMPTY_HEADER_AGGREGATES,
      rows: [],
      activeLoansCount: 0,
      errorMessage: undefined,
      refetch,
    };
  }

  return {
    state: "ready",
    summary: formatSummary(data.summary),
    headerAggregates: {
      principal: formatCompactUsd(data.summary.total_deployed),
      collateral:
        data.summary.total_collateral == null
          ? undefined
          : formatCompactUsd(data.summary.total_collateral),
      // LTV subtitle intentionally omitted — no backend portfolio_ltv field yet.
      // Do NOT compute LTV client-side. Resolved in issue #729 open-question #1.
    },
    rows: data.loans.map(formatRow),
    activeLoansCount: data.loans.length,
    errorMessage: undefined,
    refetch,
  };
}

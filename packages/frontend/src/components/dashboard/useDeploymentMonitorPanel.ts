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
import type { LoanBookRow } from "./LoanBookTable";
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
      rows: [],
      errorMessage: undefined,
      refetch,
    };
  }

  if (error) {
    return {
      state: "error",
      summary: EMPTY_SUMMARY,
      rows: [],
      errorMessage: error.message,
      refetch,
    };
  }

  if (!data || data.loans.length === 0) {
    return {
      state: "empty",
      summary: EMPTY_SUMMARY,
      rows: [],
      errorMessage: undefined,
      refetch,
    };
  }

  return {
    state: "ready",
    summary: formatSummary(data.summary),
    rows: data.loans.map(formatRow),
    errorMessage: undefined,
    refetch,
  };
}

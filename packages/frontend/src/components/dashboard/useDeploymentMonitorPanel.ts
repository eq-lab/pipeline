/**
 * Co-located hook for `DeploymentMonitorPanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel
 * (tabs data sourcing, state machine, headerAggregates, LTV aggregate calc).
 */
import { useState } from "react";
import { useLoanBook, useLoanSubmissions } from "@/api";
import type { LoanBookSummary, LoanBookEntry } from "@/api";
import type { PanelState } from "./PanelContainer";
import type { LoanBookSummaryProps } from "./LoanBookSummary";
import type { LoanBookRow, LoanBookHeaderAggregates } from "./LoanBookTable";
import type { OriginationTableRow } from "./originationRow";
import { mapSubmissionToRow } from "./originationRow";
import { toUserError } from "@/utils/userError";
import {
  formatCompactUsd,
  formatOneDecimalRate,
  formatLtv,
  formatCoverage,
  formatDurationDays,
} from "@/utils/formatCompactUsd";

// ── Formatted output types ────────────────────────────────────────────────────

/** Which Loan Book tab is currently selected. */
export type LoanBookTab = "active" | "origination";

export interface DeploymentMonitorPanelState {
  state: PanelState;
  summary: LoanBookSummaryProps;
  rows: LoanBookRow[];
  /**
   * Pre-formatted aggregate strings for the table column headers.
   * spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel (headerAggregates fields).
   */
  headerAggregates: LoanBookHeaderAggregates;
  /** Live count of active loans (loans.length when ready; 0 otherwise). */
  activeLoansCount: number;
  errorMessage: string | undefined;
  refetch: () => void;

  // ── In Origination tab (issue #755) ─────────────────────────────────────────
  /** Currently selected tab. */
  activeTab: LoanBookTab;
  /** Selects a tab. */
  setActiveTab: (tab: LoanBookTab) => void;
  /** Formatted In Origination rows (all submissions, newest first). */
  originationRows: OriginationTableRow[];
  /** Live count of submissions in origination (0 otherwise). */
  inOriginationCount: number;
  /** Independent state for the In Origination tab body. */
  originationState: PanelState;
  /** Error message for the submissions query, when `originationState === "error"`. */
  originationErrorMessage: string | undefined;
  /** Refetch handler for the submissions query. */
  refetchOrigination: () => void;
}

// ── Formatters ────────────────────────────────────────────────────────────────

// total_deployed / total_collateral displayed as served by the backend (issue
// #906 — no frontend rescaling). spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel
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
 * spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel (panel/tab state rules).
 */
export function useDeploymentMonitorPanel(): DeploymentMonitorPanelState {
  const { data, isLoading, error, refetch } = useLoanBook();
  const submissions = useLoanSubmissions();
  const [activeTab, setActiveTab] = useState<LoanBookTab>("active");

  // ── In Origination tab — independent of the Active Loans query ───────────────
  const originationRows = submissions.data
    ? submissions.data.map(mapSubmissionToRow)
    : [];
  const inOriginationCount = submissions.data?.length ?? 0;
  let originationState: PanelState;
  if (submissions.isLoading) {
    originationState = "loading";
  } else if (submissions.error) {
    originationState = "error";
  } else if (!submissions.data || submissions.data.length === 0) {
    originationState = "empty";
  } else {
    originationState = "ready";
  }

  const originationCommon = {
    activeTab,
    setActiveTab,
    originationRows,
    inOriginationCount,
    originationState,
    // spec: docs/frontend/error-handling.md — mapped, never the raw message.
    originationErrorMessage: submissions.error
      ? toUserError(submissions.error).message
      : undefined,
    refetchOrigination: submissions.refetch,
  };

  // ── Panel-level state — driven by the Active Loans query ─────────────────────
  if (isLoading) {
    return {
      state: "loading",
      summary: EMPTY_SUMMARY,
      headerAggregates: EMPTY_HEADER_AGGREGATES,
      rows: [],
      activeLoansCount: 0,
      errorMessage: undefined,
      refetch,
      ...originationCommon,
    };
  }

  if (error) {
    return {
      state: "error",
      summary: EMPTY_SUMMARY,
      headerAggregates: EMPTY_HEADER_AGGREGATES,
      rows: [],
      activeLoansCount: 0,
      // spec: docs/frontend/error-handling.md — mapped, never the raw message.
      errorMessage: toUserError(error).message,
      refetch,
      ...originationCommon,
    };
  }

  const loans = data?.loans ?? [];

  // LTV aggregate calc — spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel
  let ltvAggregate: string | undefined;
  if (loans.length > 0) {
    const sum = loans.reduce((acc, loan) => {
      const v = loan.ltv !== null ? parseFloat(loan.ltv) : 0;
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
    const avg = sum / loans.length;
    ltvAggregate = formatLtv(String(avg));
  }

  return {
    state: "ready",
    summary: data ? formatSummary(data.summary) : EMPTY_SUMMARY,
    headerAggregates: data
      ? {
          principal: formatCompactUsd(data.summary.total_deployed),
          collateral:
            data.summary.total_collateral == null
              ? undefined
              : formatCompactUsd(data.summary.total_collateral),
          ltv: ltvAggregate,
        }
      : EMPTY_HEADER_AGGREGATES,
    rows: loans.map(formatRow),
    activeLoansCount: loans.length,
    errorMessage: undefined,
    refetch,
    ...originationCommon,
  };
}

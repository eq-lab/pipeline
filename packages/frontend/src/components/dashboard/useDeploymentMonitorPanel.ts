/**
 * Co-located hook for `DeploymentMonitorPanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * Maps raw `useLoanBook` + `useLoanSubmissions` data → formatted summary cards,
 * Active Loans rows, In Origination rows, per-tab state, and the selected-tab
 * state machine, so the view layer is pure JSX with no formatting logic.
 *
 * Tabs (issue #755):
 *   - Active Loans   → `useLoanBook` (`GET /v1/loan-book`).
 *   - In Origination → `useLoanSubmissions` (`GET /v1/loan-book/submissions`).
 * The panel-level `state` follows the Active Loans query (it drives the summary
 * cards + the shared PanelContainer chrome). The In Origination tab carries its
 * own `originationState` so a slow/failed submissions fetch never blanks the
 * whole panel.
 */
import { useState } from "react";
import { useLoanBook, useLoanSubmissions } from "@/api";
import type { LoanBookSummary, LoanBookEntry, SubmissionView } from "@/api";
import type { PanelState } from "./PanelContainer";
import type { LoanBookSummaryProps } from "./LoanBookSummary";
import type { LoanBookRow, LoanBookHeaderAggregates } from "./LoanBookTable";
import {
  formatCompactUsd,
  formatOneDecimalRate,
  formatBpsRate,
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
   * Populated from `summary` by the hook (FRONTEND.md rule 2: formatting
   * lives in the hook, not in the table component).
   *
   * - `principal` — always defined when ready (total_deployed is non-null).
   * - `collateral` — defined only when `total_collateral` is non-null; `undefined`
   *   while TODO #706 (commodity price feed) is not yet merged.
   * - `ltv` — user-approved average LTV (null → 0), defined only when
   *   loans.length > 0 (seam refs #729 / #765).
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
  originationRows: LoanBookRow[];
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

/**
 * Maps a loan submission → an In Origination table row.
 *
 * Only fields the backend serves directly are surfaced. Anything the backend
 * does not provide as a discrete field renders `"—"` — we do NOT compute
 * derived metrics client-side (issue #755 decision).
 *
 * Column mapping (from `loan_data` = verbatim `SubmitLoanRequest`):
 *   - Borrower / Commodity → `borrower_id` / `commodity`.
 *   - Principal            → `economics.original_facility_size` (base-6 human units).
 *   - Rate                 → `economics.senior_interest_rate_bps` (basis points).
 *   - Protection           → `protection` (or `"—"`).
 *   - Status               → submission lifecycle `status`.
 *   - Collateral           → `"—"` — no backend collateral value (price feed, #706).
 *   - LTV                  → `"—"` — backend serves no LTV field (`initial_ccr`
 *                            is a different metric; not derived here).
 *   - Duration             → `"—"` — backend serves no duration field (only raw
 *                            origination/maturity timestamps; not derived here).
 */
function formatSubmissionRow(view: SubmissionView): LoanBookRow {
  const loan = view.loan_data;
  const econ = loan.economics;

  return {
    borrowerCommodity: `${loan.borrower_id} / ${loan.commodity}`,
    principal: formatCompactUsd(econ.original_facility_size),
    collateral: "—",
    ltv: "—",
    duration: "—",
    rate: formatBpsRate(econ.senior_interest_rate_bps),
    protection: loan.protection ?? "—",
    status: view.status,
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
 * Panel-level `state` (Active Loans query, drives summary + PanelContainer):
 *   - `loading` → panel shows `PanelLoading`.
 *   - `error`   → panel shows `PanelError` with a retry action.
 *   - `ready`   → summary + tabs render (even with zero active loans, so the
 *                 In Origination tab stays reachable; each tab renders its own
 *                 empty state inline).
 *
 * `originationState` (submissions query) drives the In Origination tab body
 * independently: `loading` / `error` / `empty` / `ready`.
 */
export function useDeploymentMonitorPanel(): DeploymentMonitorPanelState {
  const { data, isLoading, error, refetch } = useLoanBook();
  const submissions = useLoanSubmissions();
  const [activeTab, setActiveTab] = useState<LoanBookTab>("active");

  // ── In Origination tab — independent of the Active Loans query ───────────────
  const originationRows = submissions.data
    ? submissions.data.map(formatSubmissionRow)
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
    originationErrorMessage: submissions.error?.message,
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
      errorMessage: error.message,
      refetch,
      ...originationCommon,
    };
  }

  // Ready even with zero active loans — the Active Loans tab renders its own
  // inline empty state, keeping the In Origination tab reachable.
  const loans = data?.loans ?? [];

  // ── LTV column aggregate (user-approved calc, exception to no-frontend-computed-
  // metrics rule, seam refs #729 / #765). Average LTV = Σ(perRowLtv) / count,
  // where null/missing LTV contributes 0 to the sum but still counts in the
  // denominator. Only set when loans.length > 0.
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

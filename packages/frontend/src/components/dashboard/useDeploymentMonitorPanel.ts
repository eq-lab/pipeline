// spec: docs/frontend/dashboard-components.md#usedeploymentmonitorpanel
import { useState } from "react";
import {
  useLoanBook,
  useLoanSubmissions,
  normalizeOriginationSubmissionStatus,
} from "@/api";
import type { LoanBookSummary, LoanBookEntry } from "@/api";
import type { PanelState } from "./PanelContainer";
import { useDashboardChain } from "./useDashboardChain";
import type { LoanBookSummaryProps } from "./LoanBookSummary";
import type { LoanBookRow, LoanBookHeaderAggregates } from "./LoanBookTable";
import type { OriginationTableRow } from "./originationRow";
import { mapSubmissionToRow } from "./originationRow";
import { toUserError } from "@/utils/userError";
import {
  formatCompactUsd,
  formatOneDecimalRate,
  formatLtvBps,
  LTV_NO_VALUE_SENTINEL,
  formatCoverage,
  formatDurationDays,
} from "@/utils/formatCompactUsd";

// ── Formatted output types ────────────────────────────────────────────────────

export type LoanBookTab = "active" | "origination";

export interface DeploymentMonitorPanelState {
  state: PanelState;
  summary: LoanBookSummaryProps;
  rows: LoanBookRow[];
  headerAggregates: LoanBookHeaderAggregates;
  activeLoansCount: number;
  errorMessage: string | undefined;
  refetch: () => void;

  // ── In Origination tab (issue #755) ─────────────────────────────────────────
  activeTab: LoanBookTab;
  setActiveTab: (tab: LoanBookTab) => void;
  originationRows: OriginationTableRow[];
  inOriginationCount: number;
  originationState: PanelState;
  originationErrorMessage: string | undefined;
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

function averageLtvBps(loans: LoanBookEntry[]): number | null {
  const valid = loans
    .map((l) => l.ltv_bps ?? null)
    .filter(
      (v): v is number =>
        typeof v === "number" &&
        Number.isFinite(v) &&
        v !== LTV_NO_VALUE_SENTINEL,
    );
  if (valid.length === 0) return null;
  return Math.ceil(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function formatRow(entry: LoanBookEntry): LoanBookRow {
  return {
    commodity: entry.commodity,
    principal: formatCompactUsd(entry.principal),
    ltv: formatLtvBps(entry.ltv_bps ?? null),
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

const EMPTY_HEADER_AGGREGATES: LoanBookHeaderAggregates = {};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDeploymentMonitorPanel(): DeploymentMonitorPanelState {
  const { chainId } = useDashboardChain();
  const { data, isLoading, error, refetch } = useLoanBook({
    chainId,
  });
  const submissions = useLoanSubmissions();
  const [activeTab, setActiveTab] = useState<LoanBookTab>("active");

  // ── In Origination tab — independent of the Active Loans query ───────────────
  const inFlightSubmissions = (submissions.data ?? []).filter(
    (s) => normalizeOriginationSubmissionStatus(s.status) !== "Approved",
  );
  const originationRows = inFlightSubmissions.map(mapSubmissionToRow);
  const inOriginationCount = inFlightSubmissions.length;
  let originationState: PanelState;
  if (submissions.isLoading) {
    originationState = "loading";
  } else if (submissions.error) {
    originationState = "error";
  } else if (inFlightSubmissions.length === 0) {
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
      errorMessage: toUserError(error).message,
      refetch,
      ...originationCommon,
    };
  }

  const loans = data?.loans ?? [];

  const avg = averageLtvBps(loans);
  const ltvAggregate = avg === null ? undefined : formatLtvBps(avg);

  return {
    state: "ready",
    summary: data ? formatSummary(data.summary) : EMPTY_SUMMARY,
    headerAggregates: data
      ? {
          principal: formatCompactUsd(data.summary.total_deployed),
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

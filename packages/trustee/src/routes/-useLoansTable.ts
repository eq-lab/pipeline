// spec: docs/frontend/trustee-flows.md#loan-book--tables
import { useLoanBook } from "@/api/useLoanBook";
import type {
  LoanBookEntry,
  LoanBookResponse,
  LoanBookSummary,
} from "@/api/useLoanBook";
import { isStellarTarget, targetChainLabel } from "@/lib/targetChains";
import { loanRowKey } from "@/lib/loanRoute";
import { formatCompactUsd, formatCompactUsd2dp } from "@/utils/formatUsd";
import { formatFractionPct } from "@/utils/formatFractionPct";
import { formatMaturityDate } from "@/utils/formatDate";
import { toUserError } from "@/utils/userError";
import { formatLtvBps } from "./-loanSecurity";

// ── Named constants ─────────────────────────────────────────────────────────

export const CONCENTRATION_LIMIT_PCT = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

/** The status tabs, in Figma order — plus the default unfiltered "All" (#1121). */
export type LoanTab = "All" | "Active" | "Watchlist" | "Default" | "Closed";

export const LOAN_TABS: readonly LoanTab[] = [
  "All",
  "Active",
  "Watchlist",
  "Default",
  "Closed",
] as const;

// Tab → served `status` literals. spec: trustee-flows.md#ltv-column--tab-mapping.
const TAB_STATUSES: Record<Exclude<LoanTab, "All">, readonly string[]> = {
  Active: ["Performing", "Disbursing"],
  Watchlist: ["WatchList", "Past Due", "Matured"],
  Default: ["Default"],
  Closed: ["Closed"],
};

function tabMatches(tab: LoanTab, status: string): boolean {
  return tab === "All" || TAB_STATUSES[tab].includes(status);
}

export interface LtvCell {
  text: string;
  marginCallOpen: boolean;
  priceStale: boolean;
}

/** One formatted, display-ready row of the active-loan table. */
export interface LoanTableRow {
  key: string;
  /** On-chain loan id; the `/loans/$id` route param for the row-click navigation. */
  loanId: string;
  chainId: number;
  chain: string;
  originator: string;
  commodity: string;
  /** Outstanding senior, displayed as served, two-decimal compact (e.g. `$1.84M`). */
  seniorOutstanding: string;
  ltv: LtvCell | null;
  /** Nearest payment: the next payment's date, or "N days late" when overdue (#941). */
  nearestPayment: NearestPayment;
  /** Stage = the served status label (`Performing` displayed as `Active`, #1119). */
  stage: string;
  /** Raw served status, retained for the client-side tab filter/counts. */
  status: string;
}

/** Summary-card view-model (all `—` for missing fields). */
export interface LoansSummaryView {
  deployedSenior: string;
  atRiskPct: string;
  atRiskSenior: string;
  weightedRate: string;
  weightedTenor: string;
  topConcentrationPct: string;
  topConcentrationSub: string;
}

export type LoansTableState = "loading" | "error" | "empty" | "ready";

export interface UseLoansTableResult {
  state: LoansTableState;
  errorMessage: string | null;
  errorDetails: string | null;
  summary: LoansSummaryView | null;
  /** Per-tab row counts (a grouping of served rows — allowed, not a derived metric). */
  counts: Record<LoanTab, number>;
  /** Rows for the active tab only (client-side status filter). */
  rows: LoanTableRow[];
  showLtvColumn: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `"—"` for anything not a non-empty string — never fabricates a value. */
function safeString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

/** The **Nearest payment** cell — next payment date, or "N days late" when overdue. */
export interface NearestPayment {
  /** `"1 Aug 2026"` (upcoming) · `"5 days late"` / `"Due today"` (overdue) · `"—"` when unknown. */
  text: string;
  /** Past the next payment (`days_overdue` non-null) → the view paints it red. */
  overdue: boolean;
}

// Builds the Nearest payment cell (#941). spec: trustee-flows.md#loan-book--tables.
export function formatNearestPayment(
  nextPaymentUnix: number | null | undefined,
  daysOverdue: number | null | undefined,
): NearestPayment {
  if (daysOverdue != null && Number.isFinite(daysOverdue)) {
    const d = Math.max(0, Math.trunc(daysOverdue));
    const text = d === 0 ? "Due today" : `${d} day${d === 1 ? "" : "s"} late`;
    return { text, overdue: true };
  }
  if (
    nextPaymentUnix == null ||
    !Number.isFinite(nextPaymentUnix) ||
    nextPaymentUnix <= 0
  ) {
    return { text: "—", overdue: false };
  }
  return { text: formatMaturityDate(nextPaymentUnix), overdue: false };
}

export function mapLtvCell(entry: LoanBookEntry): LtvCell | null {
  if (!isStellarTarget(entry.chain_id)) return null;
  return {
    text: formatLtvBps(entry.ltv_bps ?? null),
    marginCallOpen: entry.margin_call_open === true,
    priceStale: entry.price_stale === true,
  };
}

/** Formats a whole-day tenor as `"148d"`; `null`/non-finite → `"—"`. */
function formatTenor(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return "—";
  return `${Math.round(days)}d`;
}

// ── Mappers ─────────────────────────────────────────────────────────────────

/** Maps one `LoanBookEntry` to a formatted table row. */
export function mapEntryToRow(entry: LoanBookEntry): LoanTableRow {
  return {
    key: loanRowKey(entry.chain_id, entry.loan_id),
    loanId: entry.loan_id,
    chainId: entry.chain_id,
    chain: targetChainLabel(entry.chain_id),
    originator: safeString(entry.originator),
    commodity: safeString(entry.commodity),
    seniorOutstanding: formatCompactUsd2dp(entry.senior_outstanding),
    ltv: mapLtvCell(entry),
    nearestPayment: formatNearestPayment(
      entry.next_payment_timestamp,
      entry.days_overdue,
    ),
    stage: entry.status === "Performing" ? "Active" : safeString(entry.status),
    status: entry.status,
  };
}

/** Builds the summary-card view-model from the response `summary`. */
export function mapSummary(summary: LoanBookSummary): LoansSummaryView {
  const top = summary.top_concentration;
  return {
    deployedSenior: formatCompactUsd(summary.deployed_senior),
    atRiskPct: formatFractionPct(summary.at_risk_wl_and_default_pct),
    atRiskSenior: formatCompactUsd(summary.at_risk_wl_and_default_senior),
    weightedRate: formatFractionPct(summary.weighted_rate),
    weightedTenor: formatTenor(summary.weighted_tenor_days),
    topConcentrationPct: top ? formatFractionPct(top.share) : "—",
    topConcentrationSub: top
      ? `${safeString(top.commodity)} · limit ${CONCENTRATION_LIMIT_PCT}%`
      : "—",
  };
}

function countByStatus(rows: LoanTableRow[]): Record<LoanTab, number> {
  const counts: Record<LoanTab, number> = {
    All: 0,
    Active: 0,
    Watchlist: 0,
    Default: 0,
    Closed: 0,
  };
  for (const tab of LOAN_TABS) {
    counts[tab] = rows.filter((r) => tabMatches(tab, r.status)).length;
  }
  return counts;
}

/**
 * Pure derivation of the view-model from a loaded response + the active tab.
 * Split out so the mapping is unit-testable without the query layer (the hook
 * is a thin `useLoanBook` wrapper around it).
 */
export function buildLoansView(
  data: LoanBookResponse,
  activeTab: LoanTab,
): {
  summary: LoansSummaryView;
  counts: Record<LoanTab, number>;
  rows: LoanTableRow[];
  showLtvColumn: boolean;
} {
  const allRows = data.loans.map((entry) => mapEntryToRow(entry));
  const counts = countByStatus(allRows);
  const rows = allRows.filter((r) => tabMatches(activeTab, r.status));
  const showLtvColumn = data.loans.some(
    (e) =>
      isStellarTarget(e.chain_id) &&
      ((e.ltv_bps ?? null) !== null || e.margin_call_open === true),
  );
  return { summary: mapSummary(data.summary), counts, rows, showLtvColumn };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const EMPTY_COUNTS: Record<LoanTab, number> = {
  All: 0,
  Active: 0,
  Watchlist: 0,
  Default: 0,
  Closed: 0,
};

/**
 * Wires `useLoanBook` to the Loans page's display state for the given active
 * tab. The `state` discriminant drives loading/error/empty/ready in the view
 * (mirrors `useOriginationTable`). `empty` means the whole active book is
 * empty (`loans.length === 0`) — the summary cards still render from `summary`;
 * the table shows a per-tab empty message.
 */
export function useLoansTable(
  activeTab: LoanTab,
  chainFilter: number | null = null,
): UseLoansTableResult {
  const { data, isLoading, error } = useLoanBook(chainFilter);

  if (isLoading) {
    return {
      state: "loading",
      errorMessage: null,
      errorDetails: null,
      summary: null,
      counts: EMPTY_COUNTS,
      rows: [],
      showLtvColumn: false,
    };
  }
  if (error) {
    const mapped = toUserError(error, "Failed to load the loan book.");
    return {
      state: "error",
      errorMessage: mapped.message,
      errorDetails: mapped.details,
      summary: null,
      counts: EMPTY_COUNTS,
      rows: [],
      showLtvColumn: false,
    };
  }
  if (!data) {
    return {
      state: "empty",
      errorMessage: null,
      errorDetails: null,
      summary: null,
      counts: EMPTY_COUNTS,
      rows: [],
      showLtvColumn: false,
    };
  }

  const { summary, counts, rows, showLtvColumn } = buildLoansView(
    data,
    activeTab,
  );
  return {
    state: data.loans.length === 0 ? "empty" : "ready",
    errorMessage: null,
    errorDetails: null,
    summary,
    counts,
    rows,
    showLtvColumn,
  };
}

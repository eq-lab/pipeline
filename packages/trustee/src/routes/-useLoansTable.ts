/**
 * Query-wiring + value→display mapping for the Trustee Loans page.
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` route is JSX/styling
 * only; this hook owns the `useLoanBook` call, the summary-card view-model, the
 * per-loan row mapping, the CCR classification, and the client-side status
 * filter (mirrors `-useOriginationTable.ts`).
 *
 * spec: docs/frontend/trustee-flows.md#loan-book--tables (resolved Open
 * Questions, never-fabricate defaults, CCR classification & tab mapping).
 */
import { useLoanBook } from "@/api/useLoanBook";
import type {
  LoanBookEntry,
  LoanBookResponse,
  LoanBookSummary,
} from "@/api/useLoanBook";
import { formatCompactUsd, formatCompactUsd2dp } from "@/utils/formatUsd";
import { formatMaturityDate } from "@/utils/formatDate";
import { toUserError } from "@/utils/userError";

// ── Named constants ─────────────────────────────────────────────────────────

// CCR band thresholds + concentration limit — frontend-owned policy constants.
// spec: docs/frontend/trustee-flows.md#ccr-classification--tab-mapping.
export const MAINTENANCE_MARGIN_BPS = 12_000;
export const HEALTHY_MARGIN_BPS = 13_000;
export const HARD_MARGIN_CALL_BPS = 11_000;
export const CONCENTRATION_LIMIT_PCT = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

/** The four status tabs, in Figma order. */
export type LoanTab = "Active" | "Watchlist" | "Default" | "Closed";

export const LOAN_TABS: readonly LoanTab[] = [
  "Active",
  "Watchlist",
  "Default",
  "Closed",
] as const;

// Tab → served `status` literals. spec: trustee-flows.md#ccr-classification--tab-mapping.
const TAB_STATUSES: Record<LoanTab, readonly string[]> = {
  Active: ["Performing", "Disbursing"],
  Watchlist: ["WatchList", "Past Due", "Matured"],
  Default: ["Default"],
  Closed: ["Closed"],
};

/** CCR footnote band → determines the CCR cell colour. */
export type CcrBand = "healthy" | "attention" | "margin-call" | "pre-default";

/** The commodity + 7-day spot sub-line, pre-formatted for the view. */
export interface SpotLine {
  /** e.g. `"$4,500 · −18% 7d"`. */
  text: string;
  /** Trailing 7-day change is negative → the view paints the line red. */
  negative: boolean;
}

/** The CCR cell view-model. */
export interface CcrCell {
  /** e.g. `"210%"` (whole percent, served `ccr_bps` as-is — #888). */
  percent: string;
  /** Colour band, or `null` when CCR is unavailable (renders neutral). */
  band: CcrBand | null;
  /** Staleness age from `ccr_reported_at`, e.g. `"1h"` / `"26h"`; `—` when never reported. */
  age: string;
}

/** One formatted, display-ready row of the active-loan table. */
export interface LoanTableRow {
  /** Stable list key — the served on-chain `loan_id`. */
  key: string;
  /** On-chain loan id; the `/loans/$id` route param for the row-click navigation. */
  loanId: string;
  originator: string;
  commodity: string;
  /** Spot sub-line, or `null` when the asset is unpriced (no sub-line). */
  spot: SpotLine | null;
  /** Outstanding senior, displayed as served, two-decimal compact (e.g. `$1.84M`). */
  seniorOutstanding: string;
  /** Collateral, displayed as served (issue #906 — no frontend rescaling), two-decimal compact. `$2.10M` / `—`. */
  collateral: string;
  /** CCR cell, or `null` when `ccr_bps` is unavailable. */
  ccr: CcrCell | null;
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `"—"` for anything not a non-empty string — never fabricates a value. */
function safeString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

// Classifies a served CCR (bps, used as-is) into the 4-level band.
// spec: docs/frontend/trustee-flows.md#ccr-classification--tab-mapping.
export function classifyCcr(servedBps: number | null): CcrBand | null {
  if (servedBps == null || !Number.isFinite(servedBps)) return null;
  if (servedBps >= HEALTHY_MARGIN_BPS) return "healthy";
  if (servedBps >= MAINTENANCE_MARGIN_BPS) return "attention";
  if (servedBps >= HARD_MARGIN_CALL_BPS) return "margin-call";
  return "pre-default";
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

/** Formats `ccr_reported_at` as an age (`"1h"` / `"26h"`); unreported/future → `"—"`. */
export function formatCcrAge(
  reportedAtUnix: number | null | undefined,
  nowMs: number,
): string {
  if (
    reportedAtUnix == null ||
    !Number.isFinite(reportedAtUnix) ||
    reportedAtUnix <= 0
  ) {
    return "—";
  }
  const diffMs = nowMs - reportedAtUnix * 1000;
  if (diffMs < 0) return "—";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 72) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Formats the spot sub-line, e.g. "$4,500 · −18% 7d". spec:
// trustee-flows.md#never-fabricate-defaults-exec-plan-risk-3.
export function formatSpot(
  spotPrice: string | null,
  spotChange7d: string | null,
): SpotLine | null {
  if (spotPrice == null) return null;
  const price = parseFloat(spotPrice);
  if (!Number.isFinite(price)) return null;

  const priceText = `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(price)}`;

  const change = spotChange7d == null ? NaN : parseFloat(spotChange7d);
  if (!Number.isFinite(change)) {
    return { text: priceText, negative: false };
  }
  const pct = Math.round(Math.abs(change) * 100);
  // U+2212 MINUS SIGN / U+002B PLUS SIGN, matching the Figma glyphs.
  const sign = change < 0 ? "−" : "+";
  return { text: `${priceText} · ${sign}${pct}% 7d`, negative: change < 0 };
}

/**
 * Formats a decimal-fraction string (e.g. `"0.0430"`) as a one-decimal
 * percentage (`"4.3%"`). `null`/non-finite → `"—"`. Used for the served ratio
 * fields (`at_risk_wl_and_default_pct`, `weighted_rate`, `top_concentration.share`).
 */
function formatFractionPct(fraction: string | null): string {
  if (fraction == null) return "—";
  const num = parseFloat(fraction);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

/** Formats a whole-day tenor as `"148d"`; `null`/non-finite → `"—"`. */
function formatTenor(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return "—";
  return `${Math.round(days)}d`;
}

// ── Mappers ─────────────────────────────────────────────────────────────────

/**
 * Maps one `LoanBookEntry` to a formatted table row. `nowMs` is injected (not
 * read from `Date.now()`) so the CCR-age formatting is deterministic under test.
 */
export function mapEntryToRow(
  entry: LoanBookEntry,
  nowMs: number,
): LoanTableRow {
  const servedCcrBps = entry.ccr_bps;
  const ccr: CcrCell | null =
    servedCcrBps == null || !Number.isFinite(servedCcrBps)
      ? null
      : {
          percent: `${Math.round(servedCcrBps / 100)}%`,
          band: classifyCcr(servedCcrBps),
          age: formatCcrAge(entry.ccr_reported_at, nowMs),
        };

  return {
    key: entry.loan_id,
    loanId: entry.loan_id,
    originator: safeString(entry.originator),
    commodity: safeString(entry.commodity),
    spot: formatSpot(entry.spot_price, entry.spot_change_7d),
    // Two-decimal compact (e.g. $1.84M) to match the collateral column.
    seniorOutstanding: formatCompactUsd2dp(entry.senior_outstanding),
    collateral: formatCompactUsd2dp(entry.collateral),
    ccr,
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
    Active: 0,
    Watchlist: 0,
    Default: 0,
    Closed: 0,
  };
  for (const tab of LOAN_TABS) {
    counts[tab] = rows.filter((r) =>
      TAB_STATUSES[tab].includes(r.status),
    ).length;
  }
  return counts;
}

/**
 * Pure derivation of the view-model from a loaded response + the active tab +
 * the current time. Split out so the mapping is unit-testable without the query
 * layer (the hook is a thin `useLoanBook` wrapper around it).
 */
export function buildLoansView(
  data: LoanBookResponse,
  activeTab: LoanTab,
  nowMs: number,
): {
  summary: LoansSummaryView;
  counts: Record<LoanTab, number>;
  rows: LoanTableRow[];
} {
  const allRows = data.loans.map((entry) => mapEntryToRow(entry, nowMs));
  const counts = countByStatus(allRows);
  const rows = allRows.filter((r) =>
    TAB_STATUSES[activeTab].includes(r.status),
  );
  return { summary: mapSummary(data.summary), counts, rows };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const EMPTY_COUNTS: Record<LoanTab, number> = {
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
export function useLoansTable(activeTab: LoanTab): UseLoansTableResult {
  const { data, isLoading, error } = useLoanBook();

  if (isLoading) {
    return {
      state: "loading",
      errorMessage: null,
      errorDetails: null,
      summary: null,
      counts: EMPTY_COUNTS,
      rows: [],
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
    };
  }

  const nowMs = Date.now();
  const { summary, counts, rows } = buildLoansView(data, activeTab, nowMs);
  return {
    state: data.loans.length === 0 ? "empty" : "ready",
    errorMessage: null,
    errorDetails: null,
    summary,
    counts,
    rows,
  };
}

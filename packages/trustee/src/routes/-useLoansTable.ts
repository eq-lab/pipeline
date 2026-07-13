/**
 * Query-wiring + value→display mapping for the Trustee **Loans** page (issue
 * #843, Figma node `4116:9989`).
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` route is JSX/styling
 * only; this hook owns the `useLoanBook` call, the summary-card view-model, the
 * per-loan row mapping, the CCR classification, and the client-side status
 * filter — so the view stays a pure render function and all of this is
 * unit-testable without a DOM (mirrors `-useOriginationTable.ts`).
 *
 * ## Resolved Open Questions (human, issue #843 comments)
 *
 * 1. **CCR is corrected frontend-side: `true_ccr_bps = served_ccr_bps / 1000`.**
 *    The backend computes `ccr_bps = collateral / senior_outstanding`, but
 *    `senior_outstanding` is registry-sourced (1000× too small, #840) while
 *    `collateral` is price-feed correct-scale, so the served ratio is **exactly
 *    1000× too big**. `÷1000` undoes it (`correctCcrBps`) — a member of the
 *    #840 workaround family, to be removed when the backend scale is fixed. The
 *    120% maintenance-margin pre-default threshold (`MAINTENANCE_MARGIN_BPS`) is
 *    then applied to the corrected value. Dormant today: the #706 collateral
 *    feed is mostly null → `ccr_bps` is null → CCR renders `—` and nothing is
 *    flagged.
 * 2. **Default & Closed tabs render per Figma but stay empty.** `/v1/loan-book`
 *    returns only the active set (Performing + WatchList); defaulted/closed
 *    loans are excluded backend-side, so client-side filtering yields 0 rows
 *    (count 0) for those tabs. A backend follow-up is needed to serve them.
 * 3. **The "Payments due" banner + "Record coupon" action are omitted** — no
 *    `/v1/loan-book` data source (never fabricate). Handled in the view.
 *
 * ## Never-fabricate defaults (exec-plan RISK 3)
 *
 * Figma details with no backend field are dropped, not invented:
 *   - Spot sub-line: real 7-day change basis (`spot_change_7d`), no `/t`
 *     per-tonne unit and no "30d" relabel — `formatSpot` renders `$4,500 · −18% 7d`.
 *   - Stage cell: the served `status` label only, no "· Risk Council" /
 *     "· feed stale" qualifier.
 *   - CCR staleness: the age derived from `ccr_reported_at` only
 *     (`1h` / `26h`), no "feed stale" label (its cutoff is not served).
 * Every field is read defensively → `—`, never fabricated.
 */
import { useLoanBook } from "@/api/useLoanBook";
import type {
  LoanBookEntry,
  LoanBookResponse,
  LoanBookSummary,
} from "@/api/useLoanBook";
import {
  formatCompactUsd2dp,
  formatRegistryCompactUsd,
  formatRegistryCompact2dpUsd,
} from "@/utils/formatUsd";
import { formatMaturityDate } from "@/utils/formatDate";

// ── Named constants ─────────────────────────────────────────────────────────

/**
 * 120% maintenance margin, in basis points. A loan is **pre-default** when its
 * (corrected — see `correctCcrBps`) CCR is below this. Resolved decision #2:
 * a display threshold on a served figure, NOT a backend "at-risk" flag.
 */
export const MAINTENANCE_MARGIN_BPS = 12_000;

/** 130% healthy floor, in basis points (footnote band `≥130% healthy`). */
export const HEALTHY_MARGIN_BPS = 13_000;

/**
 * Top-concentration policy limit, percent. Frontend-owned per the backend doc
 * ("the policy limit is frontend-owned") — the `top_concentration.share` figure
 * is served, this ceiling is not. Backs the card's `Cocoa · limit 10%` sub-line.
 */
export const CONCENTRATION_LIMIT_PCT = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

/** The four status tabs, in Figma order. */
export type LoanTab = "Performing" | "Watchlist" | "Default" | "Closed";

export const LOAN_TABS: readonly LoanTab[] = [
  "Performing",
  "Watchlist",
  "Default",
  "Closed",
] as const;

/**
 * Tab → served `status` literal it filters on. The backend serves `"WatchList"`
 * (capital L); the tab reads `"Watchlist"` (Figma casing).
 */
const TAB_STATUS: Record<LoanTab, string> = {
  Performing: "Performing",
  Watchlist: "WatchList",
  Default: "Default",
  Closed: "Closed",
};

/** CCR footnote band → determines the CCR cell colour. */
export type CcrBand = "healthy" | "attention" | "pre-default";

/** The commodity + 7-day spot sub-line, pre-formatted for the view. */
export interface SpotLine {
  /** e.g. `"$4,500 · −18% 7d"`. */
  text: string;
  /** Trailing 7-day change is negative → the view paints the line red. */
  negative: boolean;
}

/** The CCR cell view-model. */
export interface CcrCell {
  /** e.g. `"114%"` (whole percent, corrected value). */
  percent: string;
  /** Colour band, or `null` when CCR is unavailable (renders neutral). */
  band: CcrBand | null;
  /** Staleness age from `ccr_reported_at`, e.g. `"1h"` / `"26h"`; `—` when never reported. */
  age: string;
}

/** One formatted, display-ready row of the active-loan table. */
export interface LoanTableRow {
  /** Stable list key (`originator|commodity|maturity` — no id field is served). */
  key: string;
  originator: string;
  commodity: string;
  /** Spot sub-line, or `null` when the asset is unpriced (no sub-line). */
  spot: SpotLine | null;
  /** Outstanding senior, #840-scaled two-decimal compact (`$1.84M`). */
  seniorOutstanding: string;
  /** Collateral, two-decimal compact USD, **unscaled** (price-feed, #706). `$2.10M` / `—`. */
  collateral: string;
  /** CCR cell, or `null` when `ccr_bps` is unavailable. */
  ccr: CcrCell | null;
  /** Rollover-aware maturity, `"1 Aug 2026"`. */
  maturity: string;
  /** Stage = the served status label only (no fabricated suffix). */
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

/**
 * ⚠️ #840 workaround (issue #843, resolved Open Question 1) — REMOVE with the
 * rest of the #840 family when the backend scale is fixed.
 *
 * Served `ccr_bps` divides correct-scale collateral by registry-1000×-low
 * senior, so the ratio is exactly 1000× too big. `÷1000` restores the true CCR
 * (in bps; `14000` = 140%). `null`/non-finite passes through as `null`.
 */
export function correctCcrBps(servedCcrBps: number | null): number | null {
  if (servedCcrBps == null || !Number.isFinite(servedCcrBps)) return null;
  return servedCcrBps / 1000;
}

/**
 * Classifies a **corrected** CCR (bps; see `correctCcrBps`) into a footnote
 * band: `≥130%` healthy · `120–130%` attention · `<120%` pre-default. `null`
 * CCR → `null` (neutral render, no flag). The `<120%` band is the resolved
 * decision-#2 pre-default threshold (`MAINTENANCE_MARGIN_BPS`).
 */
export function classifyCcr(correctedBps: number | null): CcrBand | null {
  if (correctedBps == null || !Number.isFinite(correctedBps)) return null;
  if (correctedBps >= HEALTHY_MARGIN_BPS) return "healthy";
  if (correctedBps >= MAINTENANCE_MARGIN_BPS) return "attention";
  return "pre-default";
}

/**
 * Formats a `ccr_reported_at` Unix-seconds timestamp as an age relative to
 * `nowMs`, matching the Figma chips (`1h`, `26h`). `0` (never reported),
 * missing, or a future timestamp → `"—"` (never fabricate a freshness).
 */
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

/**
 * Formats the commodity spot sub-line as `"$4,500 · −18% 7d"` — the REAL
 * 7-day change basis (`spot_change_7d`), with no fabricated `/t` per-tonne unit
 * and no "30d" relabel (exec-plan RISK 3). Returns `null` when the asset is
 * unpriced (`spot_price` null) → the view renders no sub-line.
 */
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
  const correctedCcr = correctCcrBps(entry.ccr_bps);
  const ccr: CcrCell | null =
    correctedCcr == null
      ? null
      : {
          percent: `${Math.round(correctedCcr / 100)}%`,
          band: classifyCcr(correctedCcr),
          age: formatCcrAge(entry.ccr_reported_at, nowMs),
        };

  return {
    key: `${entry.originator}|${entry.commodity}|${entry.maturity}`,
    originator: safeString(entry.originator),
    commodity: safeString(entry.commodity),
    spot: formatSpot(entry.spot_price, entry.spot_change_7d),
    // #840 workaround: senior_outstanding is registry-sourced ⇒ scale ×1000.
    // Two-decimal compact (e.g. $1.84M) to match the collateral column.
    seniorOutstanding: formatRegistryCompact2dpUsd(entry.senior_outstanding),
    // collateral is price-feed sourced (#706) ⇒ already correct-scale, unscaled.
    collateral: formatCompactUsd2dp(entry.collateral),
    ccr,
    maturity: formatMaturityDate(entry.maturity),
    stage: safeString(entry.status),
    status: entry.status,
  };
}

/** Builds the summary-card view-model from the response `summary`. */
export function mapSummary(summary: LoanBookSummary): LoansSummaryView {
  const top = summary.top_concentration;
  return {
    // #840 workaround: deployed_senior / at_risk_..._senior are registry-sourced ⇒ scale ×1000.
    deployedSenior: formatRegistryCompactUsd(summary.deployed_senior),
    atRiskPct: formatFractionPct(summary.at_risk_wl_and_default_pct),
    atRiskSenior: formatRegistryCompactUsd(
      summary.at_risk_wl_and_default_senior,
    ),
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
    Performing: 0,
    Watchlist: 0,
    Default: 0,
    Closed: 0,
  };
  for (const tab of LOAN_TABS) {
    counts[tab] = rows.filter((r) => r.status === TAB_STATUS[tab]).length;
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
  const rows = allRows.filter((r) => r.status === TAB_STATUS[activeTab]);
  return { summary: mapSummary(data.summary), counts, rows };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const EMPTY_COUNTS: Record<LoanTab, number> = {
  Performing: 0,
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
      summary: null,
      counts: EMPTY_COUNTS,
      rows: [],
    };
  }
  if (error) {
    return {
      state: "error",
      errorMessage: error.message,
      summary: null,
      counts: EMPTY_COUNTS,
      rows: [],
    };
  }
  if (!data) {
    return {
      state: "empty",
      errorMessage: null,
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
    summary,
    counts,
    rows,
  };
}

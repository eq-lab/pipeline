/**
 * `SubmissionView` → In-Origination table row extraction/formatting layer
 * (issue #814, Figma node `4116-9155` — the same field set as the trustee
 * Origination page, #813).
 *
 * Mirrors `packages/trustee/src/routes/-useOriginationTable.ts`'s
 * `mapSubmissionToRow`, minus the trustee-only router-nav `submission`
 * threading and Review action (issue #814 decisions, human-confirmed):
 *
 *   - Originator  → `loan_data.originator` (the originator's name as
 *     submitted with the loan, NOT the top-level `SubmissionView.originator`
 *     authenticated-submitter address).
 *   - Commodity   → `loan_data.commodity`. The Figma also shows a valuation
 *     sub-line ("NSR · Net Smelter Return" / "Standard · price × quantity"),
 *     but no field in `loan_data`/`SubmissionView` carries a valuation mode
 *     for pre-mint submissions (`ValuationMode` lives in
 *     `loan_collateral_valuations`, keyed by an on-chain `loan_id` that
 *     submissions don't have yet). Resolved (human, issue #814 comment,
 *     mirroring #813): OMIT the sub-line entirely — do not infer it from the
 *     commodity name.
 *   - Facility    → `loan_data.economics.original_facility_size`, formatted
 *     via `formatCompactUsd` (compact M/K, e.g. `"$3.5M"`) to match the Active
 *     Loans table (#841). No #840 ×1000 correction — submission amounts are
 *     already at the correct 6-decimal scale.
 *   - Corridor    → `loan_data.corridor`, hyphen separator rendered as the
 *     Figma's arrow glyph ("PE-CN" → "PE → CN").
 *   - Rate        → `loan_data.economics.senior_interest_rate_bps`, formatted
 *     via `formatBpsRate` (e.g. `1400` → `"14.0%"`).
 *   - Maturity    → `loan_data.economics.original_maturity_date` (Unix
 *     seconds), formatted via `formatMaturityDate` (e.g. `"15 Dec 2026"`).
 *   - Submitted   → `SubmissionView.created_at` (RFC 3339), formatted via
 *     `formatSubmittedDate` (e.g. `"18 Jun"`).
 *   - Status      → the raw `SubmissionView.status` string. Resolved (human,
 *     issue #814 comment): the LP dashboard keeps its existing simple
 *     color-coded status label (`statusColorClass` in `LoanBookTable.tsx`)
 *     rather than adopting the trustee's Review-button / "Approved & minted"
 *     pill treatment — the LP app is read-only for submissions and has no
 *     review route.
 *
 * Every field is read defensively: `loan_data` is `serde_json::Value` on the
 * wire (declared as `SubmitLoanRequest` for convenience, but not guaranteed
 * to match at runtime), so missing/malformed nested fields render "—" rather
 * than fabricating or throwing. See TD-42 (`docs/exec-plans/tech-debt-tracker.md`)
 * for the trustee↔LP extractor duplication this creates.
 */
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { formatBpsRate, formatCompactUsd } from "@/utils/formatCompactUsd";
import { formatMaturityDate, formatSubmittedDate } from "@/utils/formatDate";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One formatted, display-ready row of the In-Origination table. */
export interface OriginationTableRow {
  id: number;
  originator: string;
  commodity: string;
  facility: string;
  corridor: string;
  rate: string;
  maturity: string;
  submitted: string;
  /**
   * Raw lifecycle status string (e.g. `"InReview"`) — the view renders it via
   * `statusColorClass` as a simple color-coded label (issue #814 decision).
   */
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `"—"` for anything not a non-empty string — never fabricates a value. */
function safeString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

/** `"—"` for anything not a finite number. */
function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Maps one `SubmissionView` to a formatted table row. `loan_data` is treated
 * as loosely-typed (its wire type is `serde_json::Value`) — every nested
 * field access is guarded so a missing/malformed submission never throws.
 */
export function mapSubmissionToRow(
  submission: SubmissionView,
): OriginationTableRow {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};
  const economics: Partial<SubmissionView["loan_data"]["economics"]> =
    loanData.economics ?? {};

  return {
    id: submission.id,
    originator: safeString(loanData.originator),
    commodity: safeString(loanData.commodity),
    // Compact M/K to match the Active Loans table (#841). In-origination
    // amounts come from the submission's loan_data (correct 6-decimal scale),
    // so no #840 ×1000 correction is needed here — formatting only.
    facility: formatCompactUsd(economics.original_facility_size ?? null),
    // Figma renders the corridor with an arrow separator ("PE → CN"); the
    // stored value uses a hyphen ("PE-CN"). Same data, design-matching glyph.
    corridor: safeString(loanData.corridor).replace(/\s*-\s*/g, " → "),
    rate: formatBpsRate(safeNumber(economics.senior_interest_rate_bps)),
    maturity: formatMaturityDate(safeNumber(economics.original_maturity_date)),
    submitted: formatSubmittedDate(submission.created_at),
    status: safeString(submission.status),
  };
}

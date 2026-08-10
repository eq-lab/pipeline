/**
 * `SubmissionView` → In-Origination table row extraction/formatting layer
 * (issue #814, Figma node `4116-9155`).
 *
 * spec: docs/frontend/dashboard-components.md#originationtable
 * (field-by-field mapping decisions, defensive-read rationale).
 */
import { normalizeOriginationSubmissionStatus } from "@/api/useLoanSubmissions";
import type {
  OriginationSubmissionStatus,
  SubmissionView,
} from "@/api/useLoanSubmissions";
import {
  economicsBaseUnitsToUsdDecimal,
  formatBpsRate,
  formatCompactUsd,
} from "@/utils/formatCompactUsd";
import { formatMaturityDate, formatSubmittedDate } from "@/utils/formatDate";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Human-readable Status-cell label per normalized origination status (#1053). */
export const STATUS_LABELS: Record<OriginationSubmissionStatus, string> = {
  InReview: "In review",
  ChangesRequested: "Changes requested",
  Rejected: "Rejected",
  Approved: "Approved",
};

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
  /** Normalized origination status — drives the Status cell's color. */
  status: OriginationSubmissionStatus;
  /** Human-readable Status-cell text (`STATUS_LABELS[status]`, #1053). */
  statusLabel: string;
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
 * Maps one `SubmissionView` to a formatted table row.
 * spec: docs/frontend/dashboard-components.md#originationtable (defensive reads).
 */
export function mapSubmissionToRow(
  submission: SubmissionView,
): OriginationTableRow {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};
  const economics: Partial<SubmissionView["loan_data"]["economics"]> =
    loanData.economics ?? {};
  const status = normalizeOriginationSubmissionStatus(submission.status);

  return {
    id: submission.id,
    originator: safeString(loanData.originator),
    commodity: safeString(loanData.commodity),
    // Facility scale/formatting — spec: docs/frontend/dashboard-components.md#originationtable
    facility: formatCompactUsd(
      economicsBaseUnitsToUsdDecimal(economics.original_facility_size ?? null),
    ),
    // Corridor separator glyph — spec: docs/frontend/dashboard-components.md#originationtable
    corridor: safeString(loanData.corridor).replace(/\s*-\s*/g, " → "),
    rate: formatBpsRate(safeNumber(economics.senior_interest_rate_bps)),
    maturity: formatMaturityDate(safeNumber(economics.original_maturity_date)),
    submitted: formatSubmittedDate(submission.created_at),
    status,
    statusLabel: STATUS_LABELS[status],
  };
}

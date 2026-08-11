/**
 * Query-wiring + value→display mapping for the Origination page's
 * submissions table. Per `docs/FRONTEND.md` Code structure rule 2, the
 * `.tsx` route is JSX/styling only; this hook owns the `useLoanSubmissions`
 * call and maps each `SubmissionView` into a display-ready row.
 *
 * spec: docs/frontend/trustee-flows.md#origination-table-origination-issue-813
 * (field mapping, status/action cell).
 */
import {
  normalizeOriginationSubmissionStatus,
  useLoanSubmissions,
} from "@/api/useLoanSubmissions";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { formatBpsRate, formatCompactUsd } from "@/utils/formatUsd";
import { formatMaturityDate, formatSubmittedDate } from "@/utils/formatDate";
import { economicsBaseUnitsToUsdDecimal } from "@/utils/stellarSacUnits";
import { toUserError } from "@/utils/userError";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Discriminated status/action cell — the view renders per-kind. */
export type OriginationRowStatus =
  | { kind: "approved"; label: string }
  | { kind: "in-review"; label: string }
  | { kind: "rejected"; label: string; reason: string | null }
  | { kind: "changes-requested"; label: string; reason: string | null };

/** One formatted, display-ready row of the Origination submissions table. */
export interface OriginationTableRow {
  id: number;
  originator: string;
  commodity: string;
  facility: string;
  corridor: string;
  rate: string;
  maturity: string;
  submitted: string;
  status: OriginationRowStatus;
  /**
   * The source `SubmissionView`, threaded through so the view can pass it as
   * router navigation state to `/origination/$id` (issue #821) without a
   * second lookup by `id`.
   */
  submission: SubmissionView;
}

export type OriginationTableState = "loading" | "error" | "empty" | "ready";

export interface UseOriginationTableResult {
  state: OriginationTableState;
  errorMessage: string | null;
  errorDetails: string | null;
  rows: OriginationTableRow[];
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

function resolveStatus(submission: SubmissionView): OriginationRowStatus {
  switch (normalizeOriginationSubmissionStatus(submission.status)) {
    case "Approved":
      // spec: docs/frontend/trustee-flows.md#origination-table-origination-issue-813.
      return {
        kind: "approved",
        label: `Approved · ${formatSubmittedDate(submission.updated_at)}`,
      };
    case "InReview":
      return { kind: "in-review", label: "Review" };
    case "Rejected":
      return {
        kind: "rejected",
        label: "Rejected",
        reason: submission.reason ?? null,
      };
    case "ChangesRequested":
      return {
        kind: "changes-requested",
        label: "Changes requested",
        reason: submission.reason ?? null,
      };
  }
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
    facility: formatCompactUsd(
      economicsBaseUnitsToUsdDecimal(economics.original_facility_size),
    ),
    // Figma renders the corridor with an arrow separator ("PE → CN"); the
    // stored value uses a hyphen ("PE-CN"). Same data, design-matching glyph.
    corridor: safeString(loanData.corridor).replace(/\s*-\s*/g, " → "),
    rate: formatBpsRate(safeNumber(economics.senior_interest_rate_bps)),
    maturity: formatMaturityDate(safeNumber(economics.original_maturity_date)),
    submitted: formatSubmittedDate(submission.created_at),
    status: resolveStatus(submission),
    submission,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires `useLoanSubmissions` to the Origination table's display state. The
 * `state` discriminant lets the view render loading/error/empty/ready
 * without repeating the precedence logic (mirrors
 * `useCapitalAllocationCard`'s `isLoading`/`isError` pattern, generalized to
 * add the empty case a table needs).
 */
export function useOriginationTable(): UseOriginationTableResult {
  const { data, isLoading, error } = useLoanSubmissions();

  if (isLoading) {
    return {
      state: "loading",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    };
  }
  if (error) {
    const mapped = toUserError(error, "Failed to load loan submissions.");
    return {
      state: "error",
      errorMessage: mapped.message,
      errorDetails: mapped.details,
      rows: [],
    };
  }
  // Only in-flight originations (#1044): Approved submissions (incl. backend
  // merged/lifecycle statuses, which normalize to Approved per #892) belong
  // on the Loans surfaces, not here. InReview / ChangesRequested / Rejected
  // remain — spec: docs/product-specs/trustee-dashboard.md.
  const inFlight = (data ?? []).filter(
    (s) => normalizeOriginationSubmissionStatus(s.status) !== "Approved",
  );
  if (inFlight.length === 0) {
    return { state: "empty", errorMessage: null, errorDetails: null, rows: [] };
  }
  return {
    state: "ready",
    errorMessage: null,
    errorDetails: null,
    rows: inFlight.map(mapSubmissionToRow),
  };
}

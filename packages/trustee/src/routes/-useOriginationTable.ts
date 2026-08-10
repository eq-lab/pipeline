/**
 * Query-wiring + value→display mapping for the Origination page's
 * submissions table (issue #813, Figma node `4116:9155`).
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` route is JSX/
 * styling only; this hook owns the `useLoanSubmissions` call and maps each
 * `SubmissionView` into a display-ready row so the view stays a pure render
 * function (and this mapping is unit-testable without a DOM).
 *
 * ## Field mapping (see the exec plan's Assumptions section for the backend
 * source of each field)
 *
 *   - Originator  → `loan_data.originator` (the originator's name as
 *     submitted with the loan, NOT the top-level `SubmissionView.originator`
 *     authenticated-submitter address).
 *   - Commodity   → `loan_data.commodity`. The Figma also shows a valuation
 *     sub-line ("NSR · Net Smelter Return" / "Standard · price × quantity"),
 *     but no field in `loan_data`/`SubmissionView` carries a valuation mode
 *     for pre-mint submissions (`ValuationMode` lives in
 *     `loan_collateral_valuations`, keyed by an on-chain `loan_id` that
 *     submissions don't have yet). Resolved (human, issue #813 comment):
 *     OMIT the sub-line entirely — do not infer it from the commodity name.
 *   - Facility    → `loan_data.economics.original_facility_size`, served at
 *     the on-chain 7-decimal base-unit scale — normalized ÷10^7 via
 *     `economicsBaseUnitsToUsdDecimal` (issue #912) before `formatCompactUsd`
 *     (compact, e.g. `"$3.5M"` — switched from the fully-expanded
 *     `"$3,500,000"` by #1015 to reclaim column width).
 *   - Corridor    → `loan_data.corridor`, hyphen separator rendered as the
 *     Figma's arrow glyph ("PE-CN" → "PE → CN").
 *   - Rate        → `loan_data.economics.senior_interest_rate_bps`, formatted
 *     via `formatBpsRate` (e.g. `1400` → `"14.0%"`).
 *   - Maturity    → `loan_data.economics.original_maturity_date` (Unix
 *     seconds), formatted via `formatMaturityDate` (e.g. `"15 Dec 2026"`).
 *   - Submitted   → `SubmissionView.created_at` (RFC 3339), formatted via
 *     `formatSubmittedDate` (e.g. `"18 Jun"`).
 *   - Status/action (8th column) — resolved (human, issue #813 comment; copy
 *     amended by #829):
 *     - `Approved`  → green "Approved · <date>" pill (issue #829 dropped
 *       "& minted" — the review endpoint is a pure DB status flip). Issue
 *       #831 shipped the real on-chain mint (chain-first, before the review
 *       call), but this compact table pill deliberately stays SHORT — "&
 *       minted" is restored only on the `/origination/$id` detail banner
 *       (`-origination-detail.ts`), per #831's Open Question 5 default. The
 *       date uses `updated_at` (the closest proxy for "when the status last
 *       changed to Approved").
 *     - `InReview`  → an inert/disabled "Review" button (no review route
 *       exists yet in the trustee app — see Open Questions in the exec plan;
 *       this is a Figma-shape placeholder, not a wired action).
 *     - `Rejected`  → red "Rejected" pill; `reason` (if present) is exposed
 *       for the view to show as a tooltip/title on hover.
 *     - `ChangesRequested` → sweet-orange "Changes requested" pill with `reason` on
 *       hover (#949/#950). A genuine pre-decision, non-final outcome — NOT
 *       folded into `Approved`.
 *     - Any other backend merged/lifecycle status string → displayed as
 *       `Approved` (issue #892): for Origination, a lifecycle status means the
 *       request was approved and minted, then moved into its future loan
 *       lifecycle. Origination keeps only the decision vocabulary.
 *
 * Every field is read defensively: `loan_data` is `serde_json::Value` on the
 * wire (declared as `SubmitLoanRequest` for convenience, but not guaranteed
 * to match at runtime), so missing/malformed nested fields render "—" rather
 * than fabricating or throwing. See TD-42 (`docs/exec-plans/tech-debt-tracker.md`)
 * for the trustee↔LP extractor duplication this creates.
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
      // "Approved" only (NOT "Approved & minted") — deliberately kept short
      // in this compact table pill even after #831's real on-chain mint;
      // "& minted" is restored on the `/origination/$id` detail banner only.
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
      // Non-final origination outcome (#949/#950): the trustee asked for
      // changes and is waiting on the originator to resubmit. Mirrors the
      // Rejected pill's reason exposure.
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

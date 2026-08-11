/**
 * Query-wiring + value→display mapping for the Origination details / review
 * page, the destination opened by clicking a "Review" control on the
 * Origination table or the Needs Attention section.
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` route is JSX/
 * styling only; this hook owns:
 *   - Resolving the `SubmissionView` to render (router state, or a refetch
 *     fallback for direct-URL / refresh access).
 *   - All `loan_data` field extraction, defensively guarded exactly like
 *     `-useOriginationTable.ts`'s `safeString`/`safeNumber`.
 *
 * spec: docs/frontend/trustee-flows.md#origination-detail-originationid-issue-821
 * (field mapping, resolution precedence, out-of-scope list),
 * docs/frontend/trustee-flows.md#status-conditional-footer-823-figma-node-41169656-copy-amended-by-829-restored-by-831,
 * docs/frontend/trustee-flows.md#approve--mint-confirmation-dialog-838-figma-node-411613943
 * (transaction preview).
 */
import { useMemo } from "react";
import {
  normalizeOriginationSubmissionStatus,
  useLoanSubmissions,
} from "@/api/useLoanSubmissions";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { formatBpsRate, formatFullUsd } from "@/utils/formatUsd";
import { formatMaturityDate, formatSubmittedDate } from "@/utils/formatDate";
import { economicsBaseUnitsToUsdDecimal } from "@/utils/stellarSacUnits";

// ── Router state augmentation ────────────────────────────────────────────────

/**
 * Declares the `submission` key on TanStack Router's `HistoryState` (an
 * intentionally-empty interface meant for module augmentation, mirroring the
 * `Register` pattern in `main.tsx`) so `<Link state={{ submission }}>` /
 * `navigate({ state: { submission } })` type-check without a cast at every
 * call site (`origination.tsx`'s Review control, `NeedsAttention.tsx`'s
 * Review button, and this route's own `useLocation().state` read). Declared
 * here — the one place `SubmissionView` and the router state contract are
 * both already in scope — rather than duplicated per call site.
 */
declare module "@tanstack/history" {
  interface HistoryState {
    submission?: SubmissionView;
  }
}

// ── Helpers (mirrors -useOriginationTable.ts) ────────────────────────────────

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

/** Renders the corridor hyphen as the Figma arrow glyph ("PE-CN" → "PE → CN"). */
function formatCorridor(value: unknown): string {
  return safeString(value).replace(/\s*-\s*/g, " → ");
}

// spec: docs/frontend/trustee-flows.md#origination-detail-originationid-issue-821 (Location row).
function formatLocation(value: unknown): string {
  const location =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const parts = [location.location_type, location.location_identifier].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" — ") : "—";
}

// 7-decimal base-unit scale, BigInt-safe ÷10^7 (issue #912). spec:
// docs/frontend/trustee-flows.md#data-layer-useloansubmissions.
function formatEconomicsUsd(value: unknown): string {
  return formatFullUsd(economicsBaseUnitsToUsdDecimal(value));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type OriginationDetailState = "loading" | "not-found" | "ready";

/** Status chip discriminant — mirrors the #813 table's per-status labels. */
export type StatusChip =
  | { kind: "in-review"; label: string }
  | { kind: "approved"; label: string }
  | { kind: "rejected"; label: string }
  | { kind: "changes-requested"; label: string }
  | { kind: "unknown"; label: string };

export interface LoanTermsDisplay {
  facility: string;
  senior: string;
  equity: string;
  offtakerPrice: string;
  rate: string;
  startDate: string;
  maturityDate: string;
}

export interface DocumentDisplay {
  name: string;
  uri: string;
}

export interface DealDetailsDisplay {
  originator: string;
  commodity: string;
  corridor: string;
  governingLaw: string;
  protection: string;
  /** `"{location_type} — {location_identifier}"` (`—` when both absent). */
  location: string;
  documents: DocumentDisplay[];
}

/** One `key: value` row inside the transaction-preview code block. */
export interface TransactionPreviewRow {
  /** Field name as it appears before the colon, e.g. `"originator"`. */
  label: string;
  /** Formatted value, or `"—"` when the underlying field is missing. */
  value: string;
}

/**
 * View-model for the Approve & mint dialog's transaction-preview code block
 * (issue #838, Figma `4116:13943`). `keyword` is the static
 * `"LoanRegistry.mintLoan"` call name; `rows` are rendered as
 * `  <label>: <value>,` lines (the `.tsx` adds the structural indent/comma/
 * closing paren — see `-ApproveMintDialog.tsx`).
 */
export interface TransactionPreviewDisplay {
  keyword: string;
  rows: TransactionPreviewRow[];
}

export interface OriginationDetailResult {
  state: OriginationDetailState;
  heading: string;
  breadcrumb: string;
  statusChip: StatusChip;
  loanTerms: LoanTermsDisplay;
  dealDetails: DealDetailsDisplay;
  /** Drives the status-conditional footer (issue #823) — mirrors `statusChip.kind`. */
  statusKind: StatusChip["kind"];
  /** `formatSubmittedDate(submission.updated_at)`, e.g. "2 Jan". "—" if absent. */
  reviewedDate: string;
  /**
   * `safeString(submission.reason)` — the reviewer reason shown on the Rejected
   * **and** Changes-requested banners (#950); "—" when absent / no reason given.
   */
  rejectionReason: string;
  /** The Approve & mint dialog's transaction-preview code block (issue #838). */
  transactionPreview: TransactionPreviewDisplay;
}

const EMPTY_TRANSACTION_PREVIEW: TransactionPreviewDisplay = {
  keyword: "LoanRegistry.mintLoan",
  rows: [
    { label: "originator", value: "—" },
    { label: "economics", value: "—" },
    { label: "metadataURI", value: "—" },
    { label: "initialLocation", value: "—" },
  ],
};

// ── Status chip ───────────────────────────────────────────────────────────────

function resolveStatusChip(submission: SubmissionView): StatusChip {
  switch (normalizeOriginationSubmissionStatus(submission.status)) {
    case "InReview":
      return { kind: "in-review", label: "Awaiting your review" };
    case "Approved":
      return { kind: "approved", label: "Approved" };
    case "Rejected":
      return { kind: "rejected", label: "Rejected" };
    case "ChangesRequested":
      return { kind: "changes-requested", label: "Changes requested" };
  }
}

// ── Loan Terms / Deal Details mapping ────────────────────────────────────────

function mapLoanTerms(submission: SubmissionView): LoanTermsDisplay {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};
  const economics: Partial<SubmissionView["loan_data"]["economics"]> =
    loanData.economics ?? {};

  return {
    facility: formatEconomicsUsd(economics.original_facility_size),
    senior: formatEconomicsUsd(economics.original_senior_tranche),
    equity: formatEconomicsUsd(economics.original_equity_tranche),
    offtakerPrice: formatEconomicsUsd(economics.original_offtaker_price),
    rate: (() => {
      const formatted = formatBpsRate(
        safeNumber(economics.senior_interest_rate_bps),
      );
      return formatted === "—" ? formatted : `${formatted} p.a.`;
    })(),
    startDate: formatMaturityDate(safeNumber(economics.origination_date)),
    maturityDate: formatMaturityDate(
      safeNumber(economics.original_maturity_date),
    ),
  };
}

function mapDealDetails(submission: SubmissionView): DealDetailsDisplay {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};

  return {
    originator: safeString(loanData.originator),
    commodity: safeString(loanData.commodity),
    corridor: formatCorridor(loanData.corridor),
    governingLaw: safeString(loanData.governing_law),
    protection: safeString(loanData.protection),
    location: formatLocation(loanData.initial_location),
    documents: Array.isArray(submission.documents)
      ? submission.documents.map((doc) => ({
          name: safeString(doc?.name),
          uri: typeof doc?.uri === "string" ? doc.uri : "",
        }))
      : [],
  };
}

function mapHeading(submission: SubmissionView): string {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};
  return `${safeString(loanData.originator)} — ${safeString(loanData.commodity)}`;
}

// ── Transaction preview (issue #838) ─────────────────────────────────────────

// e.g. "{ facility $3,500,000 · senior $2,800,000 · ... }" — a passthrough
// re-composition (not a derived/computed metric); missing fields fall back
// to "—" in-line rather than dropping the whole row.
function formatEconomicsSummary(
  loanData: Partial<SubmissionView["loan_data"]>,
): string {
  const economics: Partial<SubmissionView["loan_data"]["economics"]> =
    loanData.economics ?? {};

  const facility = formatEconomicsUsd(economics.original_facility_size);
  const senior = formatEconomicsUsd(economics.original_senior_tranche);
  const equity = formatEconomicsUsd(economics.original_equity_tranche);
  const offtaker = formatEconomicsUsd(economics.original_offtaker_price);
  const rate = formatBpsRate(safeNumber(economics.senior_interest_rate_bps));
  const start = formatMaturityDate(safeNumber(economics.origination_date));
  const maturity = formatMaturityDate(
    safeNumber(economics.original_maturity_date),
  );

  return `{ facility ${facility} · senior ${senior} · equity ${equity} · offtaker ${offtaker} · ${rate} · ${start} → ${maturity} }`;
}

function mapTransactionPreview(
  submission: SubmissionView,
): TransactionPreviewDisplay {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};

  return {
    keyword: "LoanRegistry.mintLoan",
    rows: [
      { label: "originator", value: safeString(loanData.originator) },
      { label: "economics", value: formatEconomicsSummary(loanData) },
      { label: "metadataURI", value: safeString(loanData.metadata_uri) },
      {
        label: "initialLocation",
        value: safeString(loanData.initial_location?.location_identifier),
      },
    ],
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Resolves the submission to render (router state, or a refetch fallback by
 * `id` for direct-URL / refresh access) and maps it to display-ready fields.
 *
 * @param id                the `$id` route param (the submission's `id`).
 * @param stateSubmission   `SubmissionView` passed via router navigation
 *                           state by the Review control, if present.
 *
 * spec: docs/frontend/trustee-flows.md#origination-detail-originationid-issue-821
 * (resolution precedence — load-bearing for Approve/Reject).
 */
export function useOriginationDetail(
  id: string,
  stateSubmission: SubmissionView | undefined,
): OriginationDetailResult {
  const { data: submissions, isLoading: submissionsLoading } =
    useLoanSubmissions();

  const submission = useMemo<SubmissionView | undefined>(() => {
    const fromList = submissions?.find((s) => String(s.id) === id);
    return fromList ?? stateSubmission;
  }, [stateSubmission, submissions, id]);

  const needsFallback = !stateSubmission;
  const submissionState: OriginationDetailState = submission
    ? "ready"
    : needsFallback && submissionsLoading
      ? "loading"
      : "not-found";

  return useMemo<OriginationDetailResult>(() => {
    if (!submission) {
      return {
        state: submissionState,
        heading: "—",
        breadcrumb: "—",
        statusChip: { kind: "unknown", label: "—" },
        loanTerms: {
          facility: "—",
          senior: "—",
          equity: "—",
          offtakerPrice: "—",
          rate: "—",
          startDate: "—",
          maturityDate: "—",
        },
        dealDetails: {
          originator: "—",
          commodity: "—",
          corridor: "—",
          governingLaw: "—",
          protection: "—",
          location: "—",
          documents: [],
        },
        statusKind: "unknown",
        reviewedDate: "—",
        rejectionReason: "—",
        transactionPreview: EMPTY_TRANSACTION_PREVIEW,
      };
    }

    const statusChip = resolveStatusChip(submission);

    return {
      state: "ready",
      heading: mapHeading(submission),
      breadcrumb: mapHeading(submission),
      statusChip,
      loanTerms: mapLoanTerms(submission),
      dealDetails: mapDealDetails(submission),
      statusKind: statusChip.kind,
      reviewedDate: formatSubmittedDate(submission.updated_at),
      rejectionReason: safeString(submission.reason),
      transactionPreview: mapTransactionPreview(submission),
    };
  }, [submission, submissionState]);
}

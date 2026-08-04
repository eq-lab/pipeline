/**
 * Query-wiring + value→display mapping for the Origination details / review
 * page (issue #821, Figma node `4116:9292`), the destination opened by
 * clicking a "Review" control on the #813 Origination table or the #818
 * Needs Attention section. Supersedes the closed #816 (which included a
 * Collateral Valuation card + `/valuations` wiring — explicitly dropped: the
 * Figma's valuation card is incorrect, and no submission is anchored
 * on-chain pre-mint, so there is no `loan_id` to call
 * `GET /v1/loan-book/{loan_id}/valuations` with).
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` route is JSX/
 * styling only; this hook owns:
 *   - Resolving the `SubmissionView` to render (router state, or a refetch
 *     fallback for direct-URL / refresh access).
 *   - All `loan_data` field extraction, defensively guarded exactly like
 *     `-useOriginationTable.ts`'s `safeString`/`safeNumber` (loan_data is
 *     `serde_json::Value` on the wire — never fabricate, always `—`).
 *
 * ## Field mapping (resolved decisions, issue #821)
 *
 *   - Heading/breadcrumb/Deal-Details "Originator" → `loan_data.originator`
 *     (the human name, e.g. "Auric Andes S.A.C.") — NOT
 *     `SubmissionView.originator` (the authenticated submitter address),
 *     which is what the #813 table's Originator column uses. Distinct
 *     sources, carried over from #816's resolved decision.
 *   - Start date  → `economics.origination_date`.
 *   - Maturity    → `economics.original_maturity_date`.
 *   - Facility/tranches/offtaker price → `economics.*` (served at the
 *     on-chain 7-decimal base-unit scale — normalized ÷10^7 via
 *     `formatEconomicsUsd` before `formatFullUsd`, issue #912).
 *   - Rate        → `economics.senior_interest_rate_bps`, `formatBpsRate`
 *     (+ " p.a." suffix per Figma "14.0% p.a.").
 *   - Corridor    → `loan_data.corridor`, arrow-formatted (same regex as #813).
 *   - Governing law → `loan_data.governing_law`.
 *   - Protection  → `loan_data.protection` (optional on the wire — `—` when absent).
 *   - Location    → `loan_data.initial_location` (#1014), rendered
 *     `{location_type} — {location_identifier}` (e.g. "Warehouse — SGS bonded
 *     stockpile, Callao, Peru"); a half missing on the wire renders alone,
 *     both missing renders `—`.
 *   - Documents   → the top-level `submission.documents` (NOT `loan_data.documents`
 *     directly — the backend already lifts it); `[]` renders a graceful empty
 *     state.
 *   - Status chip → normalized Origination status ("Awaiting your review" for
 *     `InReview`; `Approved` / `Rejected` for terminal decisions; "Changes
 *     requested" for the non-final `ChangesRequested`, #950). Backend
 *     merged/lifecycle statuses are rendered as `Approved` here (issue #892)
 *     because Origination answers whether the request was approved, not the
 *     resulting loan's current lifecycle. This is the ONLY chip rendered —
 *     the Figma's "Your key · one click" static chip and "NSR · Net Smelter
 *     Return" valuation-mode chip are both dropped (no backend data source;
 *     never fabricate a chip).
 *   - The "All three mint invariants pass" and "Originator signature
 *     verified" banners are OMITTED entirely (no backend source — do not
 *     fabricate).
 *
 * ## Status-conditional footer (issue #823, Figma node `4116:9656`; copy
 * amended by #829, restored by #831)
 *
 * The always-shown `ActionButtons` block is replaced by a footer that
 * branches on the submission's status:
 *   - InReview  → `ActionButtons`, WIRED (issue #829, extended by #831):
 *     Approve now mints on-chain first (`useDrawLoan`), then calls the
 *     review endpoint through `-useOriginationReview.ts`; Reject is
 *     unchanged (pure DB review call).
 *   - Approved  → a green banner: "Approved & minted · `<reviewedDate>`"
 *     (issue #829 dropped "& minted" pending the real mint; #831 restored it
 *     — Approve now performs a genuine trustee-wallet-signed on-chain
 *     `draw_loan` mint before this banner ever renders). The Figma's
 *     semibold navy "funded from batch #B-102 →" segment is OMITTED — no
 *     `batch` field exists on `SubmissionView`/`loan_data`; never fabricate
 *     it (resolved via #823's Open Questions).
 *   - Rejected  → a red banner: "Rejected · `<reviewedDate>` — `<rejectionReason>`".
 *   - ChangesRequested → a sweet-orange banner: "Changes requested ·
 *     `<reviewedDate>` — `<reason>`" (#950). Non-final (waiting on the
 *     originator to resubmit), so no action buttons.
 *   - Backend merged/lifecycle statuses → the Approved banner (issue #892).
 *
 * `reviewedDate` is `formatSubmittedDate(submission.updated_at)` — NOT
 * `formatMaturityDate` (which takes Unix seconds and adds the year;
 * `updated_at` is RFC 3339). This mirrors the #813 table's Approved pill,
 * which already formats its date the same way. `rejectionReason` is
 * `safeString(submission.reason)` ("—" if absent). Both are computed here
 * so the view stays a pure render (`docs/FRONTEND.md` rule 2) — see
 * `origination.$id.tsx`'s `ApprovedBanner`/`RejectedBanner`.
 *
 * Out of scope (do NOT reintroduce): `useCollateralValuation`, the
 * `CollateralValuationResponse` shape, `ValuationDisplay`/`ValuationInputRow`/
 * `WaterfallRow`, `mapValuation`, `modeLabel`, `usdOrDash`, `initial_ccr` /
 * `formatInitialCcr`, `freshnessLabel`. See the exec plan
 * (`docs/exec-plans/active/issue-821-trustee-origination-details-page.md`)
 * for why.
 *
 * ## Approve & mint transaction preview (issue #838, Figma node `4116:13943`)
 *
 * `transactionPreview` formats the same `loan_data` payload already passed to
 * `useDrawLoan` as the dark code block shown inside the Approve confirmation
 * dialog (`-ApproveMintDialog.tsx`). Fields are read defensively exactly like
 * `mapLoanTerms`/`mapDealDetails` above (never fabricate; `—` on anything
 * missing/malformed). The four green mint-invariant checklist rows the Figma
 * frame also shows are deliberately OMITTED — no backing data (consistent
 * with #821's omission of the "mint invariants pass" / "signature verified"
 * banners). The `initialLocation` line is `initial_location.location_identifier`
 * ALONE — `loan_data` carries no country field, so the Figma's "· PE" suffix
 * is not reproducible and is dropped rather than fabricated.
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

/**
 * Formats `loan_data.initial_location` as
 * `"{location_type} — {location_identifier}"` (e.g. "Warehouse — SGS bonded
 * stockpile, Callao, Peru", #1014) — the value of the fixed-label "Location"
 * row. Either half may be absent on the wire — the present half renders
 * alone; `"—"` when neither is a non-empty string. Never fabricates.
 */
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

/**
 * Formats one of the submission's four monetary economics fields
 * (`original_facility_size` / `original_senior_tranche` /
 * `original_equity_tranche` / `original_offtaker_price`) for display.
 *
 * These are served at the on-chain 7-decimal base-unit scale (e.g.
 * `"8000000000.000000"` = 8,000,000,000 base units = $800.00) — NOT
 * human-unit dollars. `economicsBaseUnitsToUsdDecimal` is BigInt-safe (÷10^7
 * — never `Number`/`parseFloat` on the raw base-unit string, values can
 * exceed 2^53); the result is handed to `formatFullUsd` (issue #912).
 */
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

/**
 * Formats the `economics` block into the single summary value shown on the
 * preview's `economics:` row, e.g.
 * `"{ facility $3,500,000 · senior $2,800,000 · equity $700,000 · offtaker
 * $3,750,000 · 14.0% · 10 Jul 2026 → 15 Dec 2026 }"`. Reuses the same
 * `formatEconomicsUsd` normalization (÷10^7 off the 7-decimal on-chain
 * base-unit scale, issue #912) as `mapLoanTerms` — this is a passthrough
 * re-composition, not a derived/computed metric. Individual missing fields
 * fall back to `—` in-line rather than dropping the whole row.
 */
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
 *                           state by the #813/#818 Review control, if present.
 *
 * ## Resolution precedence (fixed by #829 — load-bearing for Approve/Reject)
 *
 * Prefers the LIVE `useLoanSubmissions()` list copy over `stateSubmission`
 * whenever the list already contains a matching `id`; `stateSubmission` is
 * used only as an initial-render fallback (first paint, before the list
 * query has resolved a match — e.g. a direct-URL/refresh visit before the
 * list finishes loading). Before #829, `stateSubmission` always won when
 * present, so after a successful Approve/Reject the invalidated list would
 * refetch a fresh (status-flipped) copy, but the memo kept returning the
 * stale navigation-state snapshot — the footer would never flip to the
 * Approved/Rejected banner until a hard refresh dropped the router state.
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

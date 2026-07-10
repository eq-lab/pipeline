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
 *   - Facility/tranches/offtaker price → `economics.*`, `formatFullUsd`.
 *   - Rate        → `economics.senior_interest_rate_bps`, `formatBpsRate`
 *     (+ " p.a." suffix per Figma "14.0% p.a.").
 *   - Corridor    → `loan_data.corridor`, arrow-formatted (same regex as #813).
 *   - Governing law → `loan_data.governing_law`.
 *   - Documents   → the top-level `submission.documents` (NOT `loan_data.documents`
 *     directly — the backend already lifts it); `[]` renders a graceful empty
 *     state.
 *   - Status chip → `submission.status` ("Awaiting your review" for
 *     `InReview`; the other two statuses get their own labels). This is the
 *     ONLY chip rendered — the Figma's "Your key · one click" static chip and
 *     "NSR · Net Smelter Return" valuation-mode chip are both dropped (no
 *     backend data source; never fabricate a chip).
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
 *   - unknown   → falls back to the InReview `ActionButtons` footer, so the
 *     page is never actionless/blank (resolved via Open Questions).
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
 */
import { useMemo } from "react";
import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { formatBpsRate, formatFullUsd } from "@/utils/formatUsd";
import { formatMaturityDate, formatSubmittedDate } from "@/utils/formatDate";

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

// ── Types ─────────────────────────────────────────────────────────────────────

export type OriginationDetailState = "loading" | "not-found" | "ready";

/** Status chip discriminant — mirrors the #813 table's per-status labels. */
export type StatusChip =
  | { kind: "in-review"; label: string }
  | { kind: "approved"; label: string }
  | { kind: "rejected"; label: string }
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
  documents: DocumentDisplay[];
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
  /** `safeString(submission.reason)` — "—" when not Rejected / no reason given. */
  rejectionReason: string;
}

// ── Status chip ───────────────────────────────────────────────────────────────

function resolveStatusChip(submission: SubmissionView): StatusChip {
  switch (submission.status) {
    case "InReview":
      return { kind: "in-review", label: "Awaiting your review" };
    case "Approved":
      return { kind: "approved", label: "Approved" };
    case "Rejected":
      return { kind: "rejected", label: "Rejected" };
    default:
      return { kind: "unknown", label: safeString(submission.status) };
  }
}

// ── Loan Terms / Deal Details mapping ────────────────────────────────────────

function mapLoanTerms(submission: SubmissionView): LoanTermsDisplay {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};
  const economics: Partial<SubmissionView["loan_data"]["economics"]> =
    loanData.economics ?? {};

  return {
    facility: formatFullUsd(economics.original_facility_size ?? null),
    senior: formatFullUsd(economics.original_senior_tranche ?? null),
    equity: formatFullUsd(economics.original_equity_tranche ?? null),
    offtakerPrice: formatFullUsd(economics.original_offtaker_price ?? null),
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
          documents: [],
        },
        statusKind: "unknown",
        reviewedDate: "—",
        rejectionReason: "—",
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
    };
  }, [submission, submissionState]);
}

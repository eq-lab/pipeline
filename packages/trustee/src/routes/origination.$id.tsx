import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useOriginationDetail, type StatusChip } from "./-origination-detail";
import { useOriginationReview } from "./-useOriginationReview";
import { RejectReasonDialog } from "./-RejectReasonDialog";
import { ApproveMintDialog } from "./-ApproveMintDialog";

/**
 * Origination details / review page (issue #821, Figma node `4116:9292`) —
 * the destination opened by clicking a "Review" control on the #813
 * Origination table or the #818 Needs Attention section. Supersedes the
 * closed #816.
 *
 * Resolved decisions (issue #821 — see the exec plan for full detail):
 *   - NO Collateral Valuation card. The Figma's valuation card
 *     (waterfall/CCR/inputs/freshness chip/on-chain-ticks footnote) is
 *     omitted entirely — it is INCORRECT (no submission is anchored
 *     on-chain pre-mint, so there is no `loan_id` to call
 *     `GET /v1/loan-book/{loan_id}/valuations` with).
 *   - Approve / Reject render per Figma and are WIRED (issue #829) to
 *     `POST /v1/loan-book/submissions/{id}/review` via
 *     `-useOriginationReview.ts` / `useReviewSubmission`. Approve additionally
 *     performs a trustee-wallet-signed on-chain `draw_loan` mint BEFORE that
 *     review call (issue #831 — see "Approve/Reject wiring" below). As of
 *     issue #838, Approve opens the `-ApproveMintDialog` confirmation dialog
 *     (Figma `4116:13943`) rather than minting immediately — see that
 *     section. The inert "Request changes" button and the "Approval mints
 *     the loan NFT…" footer note were both removed by issue #838 (no
 *     backend endpoint for the former; the latter was redundant with the
 *     new dialog's copy).
 *   - Only the backend-backed status chip renders. The Figma's static
 *     "Your key · one click" chip and "NSR · Net Smelter Return"
 *     valuation-mode chip are both dropped — no data source, never
 *     fabricated. The "All three mint invariants pass" and "Originator
 *     signature verified" green banners are likewise omitted entirely (not
 *     gated behind a flag — there is no path to ever showing them here).
 *   - Direct-URL / refresh access (no router state): refetch the submission
 *     by `$id` from the submissions list; render a not-found state if
 *     absent.
 *
 * ## Status-conditional footer (issue #823, Figma node `4116:9656`)
 *
 * The always-shown `ActionButtons` block below is now rendered only for
 * `InReview`. `Approved` and `Rejected` submissions instead render a colored
 * banner in its place:
 *   - `ApprovedBanner` — green (`--color-pipeline-positive-primary`),
 *     "Approved & minted · `<date>`" (restored by #831 — see below). The
 *     Figma's "funded from batch #B-102 →" segment is OMITTED — no `batch`
 *     field exists on `SubmissionView`/`loan_data`; never fabricated.
 *   - `RejectedBanner` — red (`--color-pipeline-negative`), "Rejected ·
 *     `<date>` — `<reason>`" (`reason` = `SubmissionView.reason`, backed).
 *     No Figma reference exists for this state; it mirrors the Approved
 *     banner's shape/tokens in red.
 * Both dates are `updated_at` formatted via `formatSubmittedDate` (surfaced
 * as `reviewedDate` by the view-model) — NOT `formatMaturityDate` (Unix
 * seconds + year).
 *
 * ## Approve/Reject wiring (issue #829, extended by #831's chain-first mint,
 * gated behind a confirmation dialog by #838)
 *
 * `ActionButtons` (the InReview footer) now fires real mutations via
 * `useOriginationReview` (composing `useDrawLoan` and `useReviewSubmission`):
 *   - **Approve** OPENS the `-ApproveMintDialog` confirmation dialog (issue
 *     #838, Figma `4116:13943`) — it no longer mints immediately. The
 *     dialog's transaction-preview code block renders `detail.transactionPreview`
 *     (real `loan_data`, `—` fallbacks; the four green mint-invariant rows
 *     are omitted — no backing data). Clicking the dialog's "Mint loan"
 *     button runs the UNCHANGED chain-first #831 orchestration: `useDrawLoan`
 *     builds → simulates (the "verify the loan" step) → requests the
 *     connected trustee wallet's signature → submits → polls the `draw_loan`
 *     mint to a terminal status BEFORE `useReviewSubmission`'s
 *     `POST .../review {decision:"Approved"}` ever fires. The "Mint loan"
 *     button's label swaps through the mint's progress stages ("Waiting for
 *     wallet signature…" → "Submitting on-chain…" → "Confirming…" →
 *     "Finalizing approval…").
 *   - A wallet rejection or any mint failure (simulate/send/poll) makes
 *     **no** review call — the submission stays `InReview`, a mapped
 *     retryable error renders inline inside the dialog, and no signature is
 *     ever requested if the simulate step fails. Cancel/Escape/backdrop are
 *     locked while minting (see `-ApproveMintDialog.tsx`) but available once
 *     the error settles.
 *   - **Reject** is unchanged: opens `RejectReasonDialog` (re-skinned to
 *     Figma `4116:14123` by #838 — same min-5-trimmed-chars-reason logic,
 *     "Send to originator" + Cancel), a pure DB review call.
 *   - Both the page-level Reject/Approve buttons disable while any mutation
 *     is in flight; a mapped error (mint failure, or the #829 review errors:
 *     409 "already reviewed", 403 "not authorized", 401 session-expired,
 *     other generic) renders inside whichever dialog is open, or inline near
 *     the buttons as a defensive fallback if neither is.
 *   - On success, the submissions list is invalidated and
 *     `-origination-detail.ts`'s resolution fix (prefer the live list copy
 *     over stale router state) flips this footer to the Approved/Rejected
 *     banner without a manual refresh; the approve dialog closes itself on
 *     review success.
 * The inert "Request changes" button and the "Approval mints the loan NFT…"
 * footer note were both removed by issue #838.
 *
 * The `.tsx` is JSX/styling only; all data extraction + formatting lives in
 * the colocated `-origination-detail.ts` view-model hook (mirroring
 * `-useOriginationTable.ts`'s split), and all Approve/Reject orchestration
 * lives in `-useOriginationReview.ts` (`docs/FRONTEND.md` rule 2).
 */

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";

/** CheckIcon — redrawn inline (the Figma asset is a localhost dev-server SVG,
 * not fetchable at runtime); same glyph as #813's `CheckIcon` precedent. */
function CheckIcon(props: React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={13}
      height={13}
      {...props}
    >
      <path
        d="M3 6.5L5.5 9L10 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** DocumentIcon — redrawn inline (Figma node `4116:9364`'s asset is a
 * localhost dev-server SVG, not fetchable at runtime). A FILLED file glyph
 * painted with `currentColor` — the Figma asset is `fill="#000080"` (a solid
 * navy document), not a thin outline, so it's filled here to match. */
function DocumentIcon(props: React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      {...props}
    >
      {/* Filled body with the folded corner cut out via fill-rule. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 1.5C3.44772 1.5 3 1.94772 3 2.5V13.5C3 14.0523 3.44772 14.5 4 14.5H12C12.5523 14.5 13 14.0523 13 13.5V5.20711L9.29289 1.5H4ZM9 2.5V5C9 5.27614 9.22386 5.5 9.5 5.5H12L9 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function StatusPill({ status }: { status: StatusChip }) {
  if (status.kind === "in-review") {
    return (
      <span
        data-testid="origination-detail-status-chip"
        className="inline-flex items-center rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-[rgba(211,235,117,0.16)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[#6e6400]"
      >
        {status.label}
      </span>
    );
  }
  if (status.kind === "approved") {
    return (
      <span
        data-testid="origination-detail-status-chip"
        className="inline-flex items-center gap-[5px] rounded-[4px] border border-solid border-[rgba(32,128,0,0.3)] bg-[rgba(32,128,0,0.08)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[color:var(--color-pipeline-positive-primary)]"
      >
        <CheckIcon />
        {status.label}
      </span>
    );
  }
  if (status.kind === "rejected") {
    return (
      <span
        data-testid="origination-detail-status-chip"
        className="inline-flex items-center rounded-[4px] border border-solid border-[rgba(192,57,43,0.3)] bg-[rgba(192,57,43,0.08)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[color:var(--color-pipeline-negative)]"
      >
        {status.label}
      </span>
    );
  }
  if (status.kind === "changes-requested") {
    return (
      <span
        data-testid="origination-detail-status-chip"
        className="inline-flex items-center rounded-[4px] border border-solid border-[rgba(110,100,0,0.3)] bg-[rgba(110,100,0,0.08)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[#6e6400]"
      >
        {status.label}
      </span>
    );
  }
  return (
    <span
      data-testid="origination-detail-status-chip"
      className="inline-flex items-center rounded-[4px] border border-solid border-[rgba(191,189,187,0.3)] bg-[rgba(191,189,187,0.12)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[rgba(56,55,53,0.6)]"
    >
      {status.label}
    </span>
  );
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-end justify-between py-[12px]"
      style={{ borderBottom: `1px solid ${LINE_COLOR}` }}
    >
      <span className="font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[rgba(56,55,53,0.6)]">
        {label}
      </span>
      <span className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
        {value}
      </span>
    </div>
  );
}

function LoanTermsCard({
  loanTerms,
}: {
  loanTerms: import("./-origination-detail").LoanTermsDisplay;
}) {
  return (
    <div
      data-testid="origination-detail-loan-terms"
      className="flex flex-1 flex-col gap-[16px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white p-[26px]"
    >
      <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
        Loan Terms
      </h2>
      <div>
        <TermRow label="Facility size" value={loanTerms.facility} />
        <TermRow label="Senior tranche" value={loanTerms.senior} />
        <TermRow label="Equity tranche" value={loanTerms.equity} />
        <TermRow label="Offtaker price" value={loanTerms.offtakerPrice} />
        <TermRow label="Rate" value={loanTerms.rate} />
        <TermRow label="Start date" value={loanTerms.startDate} />
        <TermRow label="Maturity date" value={loanTerms.maturityDate} />
      </div>
    </div>
  );
}

function DealDetailsCard({
  dealDetails,
}: {
  dealDetails: import("./-origination-detail").DealDetailsDisplay;
}) {
  return (
    <div
      data-testid="origination-detail-deal-details"
      className="flex flex-1 flex-col gap-[16px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[27px] py-[25px]"
    >
      <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
        Deal Details
      </h2>
      <div>
        <TermRow label="Originator" value={dealDetails.originator} />
        <TermRow label="Commodity" value={dealDetails.commodity} />
        <TermRow label="Corridor" value={dealDetails.corridor} />
        <TermRow label="Governing law" value={dealDetails.governingLaw} />
      </div>
      <div
        data-testid="origination-detail-documents"
        className="flex flex-col gap-[4px]"
      >
        {dealDetails.documents.length === 0 ? (
          <p className="py-[8px] font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[rgba(56,55,53,0.6)]">
            No documents provided.
          </p>
        ) : (
          dealDetails.documents.map((doc, i) => (
            <a
              key={`${doc.name}-${i}`}
              href={doc.uri || undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={doc.uri ? undefined : true}
              className={[
                "flex items-center gap-[12px] py-[8px] no-underline",
                doc.uri ? "cursor-pointer" : "pointer-events-none",
              ].join(" ")}
              data-testid="origination-detail-document"
            >
              <span className="flex size-[32px] shrink-0 items-center justify-center rounded-[4px] bg-[rgba(0,0,128,0.06)] text-[#000080]">
                <DocumentIcon />
              </span>
              <span
                className="border-b border-dashed pb-px font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[#262524]"
                style={{ borderBottomColor: LINE_COLOR }}
              >
                {doc.name}
              </span>
            </a>
          ))
        )}
      </div>
    </div>
  );
}

interface ActionButtonsProps {
  /** Opens the approve & mint confirmation dialog (issue #838). */
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  errorMessage: string | null;
}

/**
 * The InReview footer's action buttons. `onApprove` OPENS the
 * `-ApproveMintDialog` confirmation dialog (issue #838) — the chain-first
 * mint-then-review flow (issue #831) now runs only from that dialog's "Mint
 * loan" action, not directly from this button. `onReject` opens the
 * reject-reason dialog (owned by the caller). Both buttons disable while any
 * mutation is in flight. The inert "Request changes" button and the
 * "Approval mints the loan NFT…" footer note were both removed by issue
 * #838.
 */
function ActionButtons({
  onApprove,
  onReject,
  isPending,
  errorMessage,
}: ActionButtonsProps) {
  return (
    <div className="flex flex-col items-start gap-[20px] pt-[4px]">
      {errorMessage && (
        <p
          data-testid="origination-detail-review-error"
          className="font-[family-name:var(--font-body)] text-[14px] text-[color:var(--color-pipeline-negative)]"
        >
          {errorMessage}
        </p>
      )}
      <div className="flex items-start gap-[10px]">
        <button
          type="button"
          disabled={isPending}
          aria-disabled={isPending}
          onClick={onReject}
          data-testid="origination-detail-reject"
          className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={isPending}
          aria-disabled={isPending}
          onClick={onApprove}
          data-testid="origination-detail-approve"
          className="h-[48px] rounded-[4px] bg-[#000080] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

/**
 * Green "Approved & drawn · `<date>`" banner (issue #823, Figma node
 * `4116:9656`; copy restored by #831), rendered in place of `ActionButtons`
 * for Approved submissions. Approve performs a real trustee-wallet-signed
 * on-chain `draw_loan` before this banner ever renders (issue #831).
 *
 * When the just-drawn `loanId` is known (#876 — captured from the mint tx in
 * this session), the banner appends a "View loan →" deep-link to the loan's
 * detail page so the trustee can jump straight there. On a page reload the id
 * is gone (the mint mutation's data isn't persisted — accepted residual), so
 * the link is simply omitted.
 */
function ApprovedBanner({
  date,
  loanId,
}: {
  date: string;
  loanId: number | null;
}) {
  return (
    <div
      data-testid="origination-detail-approved-banner"
      className="flex flex-wrap items-center gap-[6px] rounded-[4px] border border-solid border-[rgba(32,128,0,0.3)] bg-[rgba(32,128,0,0.08)] px-[17px] py-[11px]"
    >
      <CheckIcon
        width={15}
        height={15}
        className="text-[color:var(--color-pipeline-positive-primary)]"
      />
      <span className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-positive-primary)]">
        Approved & drawn · {date}
      </span>
      {loanId != null && (
        <Link
          to="/loans/$id"
          params={{ id: String(loanId) }}
          data-testid="origination-detail-view-loan-link"
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-positive-primary)] underline"
        >
          View loan #{loanId} →
        </Link>
      )}
    </div>
  );
}

/**
 * Red "Rejected · `<date>` — `<reason>`" banner (issue #823), rendered in
 * place of `ActionButtons` for Rejected submissions. No Figma reference
 * exists for this state — mirrors `ApprovedBanner`'s container shape in the
 * red tokens already used by this route's `StatusPill`.
 */
function RejectedBanner({ date, reason }: { date: string; reason: string }) {
  return (
    <div
      data-testid="origination-detail-rejected-banner"
      className="flex items-center gap-[6px] rounded-[4px] border border-solid border-[rgba(192,57,43,0.3)] bg-[rgba(192,57,43,0.08)] px-[17px] py-[11px]"
    >
      <span className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-negative)]">
        Rejected · {date} — {reason}
      </span>
    </div>
  );
}

/**
 * Amber "Changes requested · `<date>` — `<reason>`" banner (#950), rendered in
 * place of `ActionButtons` for ChangesRequested submissions. A non-final state —
 * the trustee already asked for changes and is waiting on the originator to
 * resubmit — so no action buttons. Mirrors `RejectedBanner`'s shape in the
 * `#6e6400` amber one-off (no token; matches the `StatusPill` chip).
 */
function ChangesRequestedBanner({
  date,
  reason,
}: {
  date: string;
  reason: string;
}) {
  return (
    <div
      data-testid="origination-detail-changes-requested-banner"
      className="flex items-center gap-[6px] rounded-[4px] border border-solid border-[rgba(110,100,0,0.3)] bg-[rgba(110,100,0,0.08)] px-[17px] py-[11px]"
    >
      <span className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[#6e6400]">
        Changes requested · {date} — {reason}
      </span>
    </div>
  );
}

function DetailFooter({
  statusKind,
  reviewedDate,
  rejectionReason,
  mintedLoanId,
  onApprove,
  onReject,
  isPending,
  errorMessage,
}: {
  statusKind: StatusChip["kind"];
  reviewedDate: string;
  rejectionReason: string;
  mintedLoanId: number | null;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  errorMessage: string | null;
}) {
  if (statusKind === "approved") {
    return <ApprovedBanner date={reviewedDate} loanId={mintedLoanId} />;
  }
  if (statusKind === "rejected") {
    return <RejectedBanner date={reviewedDate} reason={rejectionReason} />;
  }
  if (statusKind === "changes-requested") {
    // Non-final: waiting on the originator to resubmit, so no action buttons (#950).
    return (
      <ChangesRequestedBanner date={reviewedDate} reason={rejectionReason} />
    );
  }
  // Only InReview falls back to the (now wired) action buttons. Backend
  // merged/lifecycle statuses normalize to Approved in the presenter (#892).
  return (
    <ActionButtons
      onApprove={onApprove}
      onReject={onReject}
      isPending={isPending}
      errorMessage={errorMessage}
    />
  );
}

function OriginationDetail() {
  const { id } = Route.useParams();
  const location = useLocation();
  const stateSubmission = location.state.submission;

  const detail = useOriginationDetail(id, stateSubmission);
  const review = useOriginationReview(id);

  if (detail.state === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[30px] px-[56px] pt-[39px] pb-[80px]">
        <div
          data-testid="origination-detail-loading"
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading submission"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[60px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      </main>
    );
  }

  if (detail.state === "not-found") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[30px] px-[56px] pt-[39px] pb-[80px]">
        <p
          data-testid="origination-detail-not-found"
          className="font-[family-name:var(--font-body)] text-[16px] text-[rgba(56,55,53,0.6)]"
        >
          Submission not found.{" "}
          <Link to="/origination" className="text-[#000080] underline">
            Back to Origination
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[8px] px-[56px] pt-[39px] pb-[80px]">
      <p className="font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524]">
        <Link
          to="/origination"
          className="text-[#262524] no-underline hover:underline"
        >
          Origination
        </Link>
        <span className="text-[rgba(56,55,53,0.6)]">
          {" "}
          / {detail.breadcrumb}
        </span>
      </p>
      <h1 className="font-[family-name:var(--font-display)] text-[48px] leading-[52.8px] text-[#262524]">
        {detail.heading}
      </h1>
      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        <StatusPill status={detail.statusChip} />
      </div>

      <div className="flex flex-col gap-[24px] rounded-[4px] bg-white px-[32px] pt-[48px] pb-[32px]">
        <div className="flex w-full gap-[20px]">
          <LoanTermsCard loanTerms={detail.loanTerms} />
          <DealDetailsCard dealDetails={detail.dealDetails} />
        </div>

        <DetailFooter
          statusKind={detail.statusKind}
          reviewedDate={detail.reviewedDate}
          rejectionReason={detail.rejectionReason}
          mintedLoanId={review.mintedLoanId}
          onApprove={review.openApprove}
          onReject={review.openReject}
          isPending={review.isPending}
          // While either dialog is open, its own error surface (below) owns
          // the mutation error — avoid rendering it twice.
          errorMessage={
            review.approveOpen || review.rejectOpen ? null : review.errorMessage
          }
        />
      </div>

      <ApproveMintDialog
        open={review.approveOpen}
        onCancel={review.cancelApprove}
        onConfirm={review.approve}
        isSubmitting={review.isPending}
        mintingLabel={review.mintingLabel}
        errorMessage={review.approveOpen ? review.errorMessage : null}
        preview={detail.transactionPreview}
      />

      <RejectReasonDialog
        open={review.rejectOpen}
        originator={detail.dealDetails.originator}
        onCancel={review.cancelReject}
        onSubmit={review.submitReject}
        isSubmitting={review.isPending}
        errorMessage={review.rejectOpen ? review.errorMessage : null}
      />
    </main>
  );
}

export const Route = createFileRoute("/origination/$id")({
  component: OriginationDetail,
});

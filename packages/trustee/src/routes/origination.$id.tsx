import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useOriginationDetail, type StatusChip } from "./-origination-detail";
import { useOriginationReview } from "./-useOriginationReview";
import { RejectReasonDialog } from "./-RejectReasonDialog";
import { RequestChangesDialog } from "./-RequestChangesDialog";
import { ApproveMintDialog } from "./-ApproveMintDialog";
import { DocumentIcon } from "@/components/DocumentIcon";
import { InlineError } from "@pipeline/ui";

/**
 * Origination details / review page — the destination opened by clicking a
 * "Review" control on the Origination table or the Needs Attention section.
 * The `.tsx` is JSX/styling only; all data extraction + formatting lives in
 * the colocated `-origination-detail.ts` view-model hook, and all
 * Approve/Reject orchestration lives in `-useOriginationReview.ts`
 * (`docs/FRONTEND.md` rule 2).
 *
 * spec: docs/frontend/trustee-flows.md#origination-detail-originationid-issue-821,
 * docs/frontend/trustee-flows.md#status-conditional-footer-823-figma-node-41169656-copy-amended-by-829-restored-by-831,
 * docs/frontend/trustee-flows.md#chain-first-approve-ordering-831.
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
        className="inline-flex items-center rounded-[4px] border border-solid border-[rgba(194,80,10,0.3)] bg-[rgba(194,80,10,0.08)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[#c2500a]"
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
      className="flex items-baseline justify-between gap-[16px] py-[12px]"
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
        <TermRow label="Protection" value={dealDetails.protection} />
        <TermRow label="Location" value={dealDetails.location} />
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
  /** Opens the request-changes reason dialog (#1017). */
  onRequestChanges: () => void;
  isPending: boolean;
  errorMessage: string | null;
  errorDetails: string | null;
}

// spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831,
// docs/frontend/trustee-flows.md#request-changes-1017.
function ActionButtons({
  onApprove,
  onReject,
  onRequestChanges,
  isPending,
  errorMessage,
  errorDetails,
}: ActionButtonsProps) {
  return (
    <div className="flex flex-col items-start gap-[20px] pt-[4px]">
      {errorMessage && (
        <div data-testid="origination-detail-review-error">
          <InlineError
            message={errorMessage}
            details={errorDetails ?? undefined}
            className="block text-[14px]"
          />
        </div>
      )}
      <div className="flex items-start gap-[10px]">
        <button
          type="button"
          disabled={isPending}
          aria-disabled={isPending}
          onClick={onApprove}
          data-testid="origination-detail-approve"
          className="h-[40px] rounded-[4px] bg-[#000080] px-[17px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
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
          onClick={onRequestChanges}
          data-testid="origination-detail-request-changes"
          className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Request changes
        </button>
      </div>
    </div>
  );
}

// spec: docs/frontend/trustee-flows.md#status-conditional-footer-823-figma-node-41169656-copy-amended-by-829-restored-by-831.
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

// spec: docs/frontend/trustee-flows.md#status-conditional-footer-823-figma-node-41169656-copy-amended-by-829-restored-by-831.
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

// spec: docs/frontend/trustee-flows.md#status-conditional-footer-823-figma-node-41169656-copy-amended-by-829-restored-by-831.
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
      className="flex items-center gap-[6px] rounded-[4px] border border-solid border-[rgba(194,80,10,0.3)] bg-[rgba(194,80,10,0.08)] px-[17px] py-[11px]"
    >
      <span className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[#c2500a]">
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
  onRequestChanges,
  isPending,
  errorMessage,
  errorDetails,
}: {
  statusKind: StatusChip["kind"];
  reviewedDate: string;
  rejectionReason: string;
  mintedLoanId: number | null;
  onApprove: () => void;
  onReject: () => void;
  onRequestChanges: () => void;
  isPending: boolean;
  errorMessage: string | null;
  errorDetails: string | null;
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
      onRequestChanges={onRequestChanges}
      isPending={isPending}
      errorMessage={errorMessage}
      errorDetails={errorDetails}
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

  if (detail.state === "error") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[30px] px-[56px] pt-[39px] pb-[80px]">
        <Link
          to="/origination"
          className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
        >
          ‹ Origination
        </Link>
        <div
          data-testid="origination-detail-error"
          className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
        >
          <InlineError
            message={detail.errorMessage ?? "Failed to load the submission."}
            details={detail.errorDetails ?? undefined}
          />
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
          onRequestChanges={review.openRequestChanges}
          isPending={review.isPending}
          // While any dialog is open, its own error surface (below) owns
          // the mutation error — avoid rendering it twice.
          errorMessage={
            review.approveOpen || review.rejectOpen || review.requestChangesOpen
              ? null
              : review.errorMessage
          }
          errorDetails={
            review.approveOpen || review.rejectOpen || review.requestChangesOpen
              ? null
              : review.errorDetails
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
        errorDetails={review.approveOpen ? review.errorDetails : null}
        preview={detail.transactionPreview}
      />

      <RejectReasonDialog
        open={review.rejectOpen}
        originator={detail.dealDetails.originator}
        onCancel={review.cancelReject}
        onSubmit={review.submitReject}
        isSubmitting={review.isPending}
        errorMessage={review.rejectOpen ? review.errorMessage : null}
        errorDetails={review.rejectOpen ? review.errorDetails : null}
      />

      <RequestChangesDialog
        open={review.requestChangesOpen}
        originator={detail.dealDetails.originator}
        onCancel={review.cancelRequestChanges}
        onSubmit={review.submitRequestChanges}
        isSubmitting={review.isPending}
        errorMessage={review.requestChangesOpen ? review.errorMessage : null}
        errorDetails={review.requestChangesOpen ? review.errorDetails : null}
      />
    </main>
  );
}

export const Route = createFileRoute("/origination/$id")({
  component: OriginationDetail,
});

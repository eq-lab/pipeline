import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useOriginationDetail, type StatusChip } from "./-origination-detail";

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
 *   - Approve / Reject / Request changes render per Figma but are
 *     inert/disabled (the Type-1 review/mint flow is a separate sub-issue).
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
 * The `.tsx` is JSX/styling only; all data extraction + formatting lives in
 * the colocated `-origination-detail.ts` view-model hook, mirroring
 * `-useOriginationTable.ts`'s split (`docs/FRONTEND.md` rule 2).
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

function ActionButtons() {
  return (
    <div className="flex flex-col items-start gap-[20px] pt-[4px]">
      <p className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-[rgba(56,55,53,0.6)]">
        Approval mints the loan NFT from your Trustee key. Disbursement is the
        separate Cash Management stage you co-sign next.
      </p>
      <div className="flex items-start gap-[10px]">
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="origination-detail-request-changes"
          className="h-[40px] cursor-not-allowed rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]"
        >
          Request changes
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="origination-detail-reject"
          className="h-[40px] cursor-not-allowed rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]"
        >
          Reject
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="origination-detail-approve"
          className="h-[48px] cursor-not-allowed rounded-[4px] bg-[#000080] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function OriginationDetail() {
  const { id } = Route.useParams();
  const location = useLocation();
  const stateSubmission = location.state.submission;

  const detail = useOriginationDetail(id, stateSubmission);

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

        <ActionButtons />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/origination/$id")({
  component: OriginationDetail,
});

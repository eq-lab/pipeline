import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import {
  useOriginationDetail,
  type StatusChip,
  type ValuationDisplay,
} from "./-origination-detail";

/**
 * Origination details / review page (issue #816, Figma node `4116:9292`) —
 * the destination opened by clicking a row on the #813 Origination table.
 *
 * Resolved decisions (human, issue #816 comments — see the exec plan for
 * full detail):
 *   - The valuation card is a shell + empty state today: every current
 *     submission 404s `/valuations` (verified on stage) because the on-chain
 *     loan doesn't exist pre-mint. That 404/`waterfall: null` state is
 *     rendered as a clean "awaiting valuation" empty state — NEVER an error
 *     banner, NEVER a fabricated number.
 *   - Approve / Reject / Request changes render per Figma but are
 *     inert/disabled (the Type-1 review/mint flow is a separate sub-issue).
 *   - Only backend-backed banners/chips render: the status chip and the
 *     valuation-mode chip (only once `/valuations` succeeds). The Figma's
 *     "All three mint invariants pass" and "Originator signature verified"
 *     banners are omitted — no data source, never fabricated.
 *   - Direct-URL / refresh access (no router state): refetch the submission
 *     by `$loanId` from the submissions list; render a not-found state if
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
 * localhost dev-server SVG, not fetchable at runtime). A simple file glyph
 * painted with `currentColor`. */
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
      <path
        d="M4 1.5H9L12.5 5V13.5C12.5 14.0523 12.0523 14.5 11.5 14.5H4.5C3.94772 14.5 3.5 14.0523 3.5 13.5V2.5C3.5 1.94772 3.94772 1.5 4 1.5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M9 1.5V5H12.5"
        stroke="currentColor"
        strokeWidth="1.1"
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
  return (
    <span
      data-testid="origination-detail-status-chip"
      className="inline-flex items-center rounded-[4px] border border-solid border-[rgba(191,189,187,0.3)] bg-[rgba(191,189,187,0.12)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[rgba(56,55,53,0.6)]"
    >
      {status.label}
    </span>
  );
}

function NeutralChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[4px] bg-[rgba(191,189,187,0.12)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[rgba(56,55,53,0.6)]">
      {children}
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

function GreenBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-[4px] border border-solid border-[rgba(32,128,0,0.3)] bg-[rgba(32,128,0,0.08)] px-[19px] py-[14px] font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#208000]">
      {children}
      <CheckIcon />
    </div>
  );
}

function LoanTermsCard({
  loanTerms,
  showMintInvariants,
}: {
  loanTerms: import("./-origination-detail").LoanTermsDisplay;
  showMintInvariants: boolean;
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
      {/* "All three mint invariants pass" banner OMITTED — no backend source
          for this claim (Open Question #4, resolved: do not fabricate). Only
          rendered if a future data source is wired (showMintInvariants stays
          false today). */}
      {showMintInvariants ? (
        <GreenBanner>All three mint invariants pass</GreenBanner>
      ) : null}
    </div>
  );
}

function DealDetailsCard({
  dealDetails,
  showSignatureVerified,
}: {
  dealDetails: import("./-origination-detail").DealDetailsDisplay;
  showSignatureVerified: boolean;
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
            <div
              key={`${doc.name}-${i}`}
              className="flex items-center gap-[12px] py-[8px]"
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
            </div>
          ))
        )}
      </div>
      {/* "Originator signature verified" banner OMITTED — no backend source
          (Open Question #4, resolved: do not fabricate). */}
      {showSignatureVerified ? (
        <GreenBanner>Originator signature verified</GreenBanner>
      ) : null}
    </div>
  );
}

function ValuationInputsColumn({ valuation }: { valuation: ValuationDisplay }) {
  return (
    <div
      className="flex flex-1 flex-col"
      data-testid="origination-detail-valuation-inputs"
    >
      <p className="pb-[9px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] text-[rgba(56,55,53,0.6)] uppercase">
        Inputs — offtake · assay · trustee feed
      </p>
      {valuation.inputRows.length === 0 ? (
        <TermRow label="Inputs" value="—" />
      ) : (
        valuation.inputRows.map((row) => (
          <div
            key={row.label}
            className="flex items-end justify-between py-[12px]"
            style={{ borderBottom: `1px solid ${LINE_COLOR}` }}
          >
            <span className="font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[rgba(56,55,53,0.6)]">
              {row.label}
            </span>
            <span className="flex flex-col items-end">
              <span className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
                {row.value}
              </span>
              {row.subLabel ? (
                <span className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] text-[rgba(56,55,53,0.6)]">
                  {row.subLabel}
                </span>
              ) : null}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function ValuationWaterfallColumn({
  valuation,
}: {
  valuation: ValuationDisplay;
}) {
  const title =
    valuation.modeLabel === "Standard"
      ? "Standard-goods valuation → CCR"
      : "NSR waterfall → CCR";

  return (
    <div
      className="flex flex-1 flex-col"
      data-testid="origination-detail-valuation-waterfall"
    >
      <p className="pb-[9px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] text-[rgba(56,55,53,0.6)] uppercase">
        {title}
      </p>
      {valuation.waterfallRows.length === 0 ? (
        <TermRow label="Collateral value" value="—" />
      ) : (
        valuation.waterfallRows.map((row) => (
          <TermRow key={row.label} label={row.label} value={row.value} />
        ))
      )}
      <div className="flex items-end justify-between py-[12px]">
        <span className="font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[rgba(56,55,53,0.6)]">
          CCR
        </span>
        <span
          data-testid="origination-detail-ccr"
          className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] font-bold text-[#208000]"
        >
          {valuation.ccrLabel ?? "—"}
        </span>
      </div>
      {/* Distinct from the live "CCR" row above: this is the CCR the
          originator submitted (`loan_data.initial_ccr`), a real/backed
          figure available even while `/valuations` still 404s pre-mint.
          Clearly labeled "at submission" so it is never mistaken for a
          recomputed/live figure. */}
      {valuation.initialCcrLabel ? (
        <div
          className="flex items-end justify-between py-[12px]"
          style={{ borderTop: `1px solid ${LINE_COLOR}` }}
        >
          <span className="font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[rgba(56,55,53,0.6)]">
            Initial CCR (at submission)
          </span>
          <span
            data-testid="origination-detail-initial-ccr"
            className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]"
          >
            {valuation.initialCcrLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function CollateralValuationCard({
  valuation,
}: {
  valuation: ValuationDisplay;
}) {
  const title = valuation.modeLabel
    ? `Collateral valuation — ${valuation.modeLabel}`
    : "Collateral valuation";

  return (
    <div
      data-testid="origination-detail-valuation"
      className="flex w-full flex-col gap-[8px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[27px] py-[25px]"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
          {title}
        </h2>
        {valuation.freshnessLabel ? (
          <span
            data-testid="origination-detail-freshness-chip"
            className="rounded-[4px] border border-solid border-[rgba(0,0,128,0.25)] bg-[rgba(0,0,128,0.06)] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] text-[#000080]"
          >
            {valuation.freshnessLabel}
          </span>
        ) : null}
      </div>
      {!valuation.hasData ? (
        <p
          data-testid="origination-detail-valuation-empty"
          className="font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[rgba(56,55,53,0.6)]"
        >
          Awaiting valuation — this loan has not been anchored on-chain yet.
        </p>
      ) : null}
      <div className="flex w-full gap-[40px]">
        <ValuationInputsColumn valuation={valuation} />
        <ValuationWaterfallColumn valuation={valuation} />
      </div>
      <p className="pt-[6px] font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-[rgba(56,55,53,0.6)]">
        On-chain nothing changes on price ticks — you write CCR + timestamp to
        LoanRegistry only when it crosses 130 / 120 / 110%. The Relayer never
        writes on-chain.
      </p>
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
          className="h-[40px] cursor-not-allowed rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] opacity-60"
        >
          Request changes
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="origination-detail-reject"
          className="h-[40px] cursor-not-allowed rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] opacity-60"
        >
          Reject
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="origination-detail-approve"
          className="h-[48px] cursor-not-allowed rounded-[4px] bg-[#000080] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white opacity-60"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function OriginationDetail() {
  const { loanId } = Route.useParams();
  const location = useLocation();
  const stateSubmission = (
    location.state as { submission?: SubmissionView } | undefined
  )?.submission;

  const detail = useOriginationDetail(loanId, stateSubmission);

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
        Origination
        <span className="text-[rgba(56,55,53,0.6)]">
          {" "}
          / {detail.breadcrumb}
        </span>
      </p>
      <h1 className="font-[family-name:var(--font-display)] text-[48px] leading-[52.8px] text-[#262524]">
        {detail.heading}
      </h1>
      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        <NeutralChip>Your key · one click</NeutralChip>
        {detail.valuation.modeLabel ? (
          <NeutralChip>
            {detail.valuation.modeLabel === "NSR"
              ? "NSR · Net Smelter Return"
              : detail.valuation.modeLabel}
          </NeutralChip>
        ) : null}
        <StatusPill status={detail.statusChip} />
      </div>

      <div className="flex flex-col gap-[24px] rounded-[4px] bg-white px-[32px] pt-[48px] pb-[32px]">
        <div className="flex w-full gap-[20px]">
          <LoanTermsCard
            loanTerms={detail.loanTerms}
            showMintInvariants={false}
          />
          <DealDetailsCard
            dealDetails={detail.dealDetails}
            showSignatureVerified={false}
          />
        </div>

        <CollateralValuationCard valuation={detail.valuation} />

        <ActionButtons />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/origination/$loanId")({
  component: OriginationDetail,
});

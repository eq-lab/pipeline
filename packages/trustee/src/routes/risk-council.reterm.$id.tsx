import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useRiskCouncilReterm,
  type RetermCurrentTerms,
  type RetermProposedTerms,
} from "./-risk-council-reterm";

/**
 * Risk Council — Amend economics (off-cycle re-term). The second of the
 * three Type-3 RISK_COUNCIL proposal screens.
 *
 * spec: docs/frontend/trustee-flows.md#amend-economics--off-cycle-re-term-flow-11--read-only-review
 * (flow, routing).
 */

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
const INK = "#262524";
const INK_MUTED = "rgba(56,55,53,0.6)";
const INK_SUBTLE = "rgba(56,55,53,0.3)";
const NEGATIVE_RED = "#b20000";
const ATTENTION_AMBER = "#6e6400";
const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";
const BRAND = "var(--color-pipeline-brand)";

// ── Small building blocks ─────────────────────────────────────────────────────

function Chip({
  children,
  color,
  bg,
  border,
  testId,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
      style={{ color, backgroundColor: bg, borderColor: border }}
    >
      {children}
    </span>
  );
}

/** A provenance tag with a coloured dot, e.g. `● loan state`. */
function DotTag({ label, dotColor }: { label: string; dotColor: string }) {
  return (
    <span
      className="inline-flex items-center gap-[6px] rounded-[4px] border border-solid px-[8px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
      style={{ color: INK_MUTED, borderColor: LINE_COLOR }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-[7px] rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      {label}
    </span>
  );
}

function TermRow({
  label,
  value,
  isLast,
  testId,
}: {
  label: string;
  value: string;
  isLast?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-end justify-between gap-[16px] py-[12px]"
      style={isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }}
    >
      <span
        className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
        style={{ color: INK_MUTED }}
      >
        {label}
      </span>
      <span
        className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px]"
        style={{ color: INK }}
      >
        {value}
      </span>
    </div>
  );
}

function TermsCard({
  title,
  children,
  tags,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  tags: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex w-full flex-1 flex-col rounded-[4px] bg-white px-[26px] py-[24px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      <h2 className="pb-[6px] font-[family-name:var(--font-display)] text-[26px] leading-[35.84px] text-[#262524]">
        {title}
      </h2>
      <div>{children}</div>
      <div className="flex flex-wrap items-center gap-[8px] pt-[16px]">
        {tags}
      </div>
    </div>
  );
}

function CurrentTermsCard({ current }: { current: RetermCurrentTerms }) {
  return (
    <TermsCard
      title="Current terms"
      testId="risk-council-reterm-current"
      tags={
        <>
          <DotTag label="loan state" dotColor={BRAND} />
          <DotTag label="collateral report" dotColor={ATTENTION_AMBER} />
        </>
      }
    >
      <TermRow
        label="Loan"
        value={current.loan}
        testId="risk-council-reterm-loan"
      />
      <TermRow label="Coupon" value={current.coupon} />
      <TermRow label="Maturity" value={current.maturity} />
      <TermRow label="CCR" value={current.ccr} isLast />
    </TermsCard>
  );
}

function ProposedTermsCard({ proposed }: { proposed: RetermProposedTerms }) {
  return (
    <TermsCard
      title="Proposed terms"
      testId="risk-council-reterm-proposed"
      tags={<DotTag label="proposal payload" dotColor={POSITIVE_GREEN} />}
    >
      <TermRow
        label="Coupon"
        value={proposed.coupon}
        testId="risk-council-reterm-proposed-coupon"
      />
      <TermRow label="Maturity extension" value={proposed.maturityExtension} />
      <TermRow
        label="Additional collateral covenant"
        value={proposed.covenant}
      />
      <TermRow
        label="Expected status after execute"
        value={proposed.expectedStatus}
        isLast
      />
    </TermsCard>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      to="/risk-council"
      className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
    >
      ‹ Risk Council
    </Link>
  );
}

function RiskCouncilReterm() {
  const { id } = Route.useParams();
  const view = useRiskCouncilReterm(id);

  if (view.state === "error") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
        <BackLink />
        <div
          role="alert"
          data-testid="risk-council-reterm-error"
          className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
        >
          {view.errorMessage ?? "Failed to load the loan."}
        </div>
      </main>
    );
  }

  if (view.state === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
        <div
          data-testid="risk-council-reterm-loading"
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading loan"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[120px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      </main>
    );
  }

  if (view.state === "not-found") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
        <p
          data-testid="risk-council-reterm-not-found"
          className="font-[family-name:var(--font-body)] text-[16px]"
          style={{ color: INK_MUTED }}
        >
          Loan not found.{" "}
          <Link to="/risk-council" className="text-[#000080] underline">
            Back to Risk Council
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[8px] px-[56px] pt-[39px] pb-[105px]">
      <BackLink />
      <div className="flex items-baseline justify-between gap-[16px] pt-[4px]">
        <h1
          className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px]"
          style={{ color: INK_SUBTLE }}
        >
          Risk proposal
        </h1>
        <span
          data-testid="risk-council-reterm-timestamp"
          className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
          style={{ color: INK_MUTED }}
        >
          {view.timestamp}
        </span>
      </div>

      <div
        data-testid="risk-council-reterm-card"
        className="mt-[8px] flex w-full flex-col gap-[16px] rounded-[6px] bg-white px-[30px] py-[28px]"
        style={{ border: `1px solid ${LINE_COLOR}` }}
      >
        <p className="font-[family-name:var(--font-body)] text-[16px] leading-[22.4px]">
          <span className="font-semibold" style={{ color: INK }}>
            Risk Council
          </span>{" "}
          <span style={{ color: INK_MUTED }}>/ Proposal</span>
        </p>
        <h2 className="font-[family-name:var(--font-display)] text-[40px] leading-[44px] text-[#262524]">
          Amend economics — off-cycle re-term
        </h2>

        <div className="flex flex-wrap items-center gap-[8px]">
          <Chip
            testId="risk-council-reterm-chip-timelock"
            color={ATTENTION_AMBER}
            bg="rgba(211,235,117,0.16)"
            border={LINE_COLOR}
          >
            24h timelock
          </Chip>
          <Chip
            testId="risk-council-reterm-chip-guardian"
            color={BRAND}
            bg="rgba(0,0,128,0.06)"
            border="rgba(0,0,128,0.3)"
          >
            Guardian can cancel
          </Chip>
          <Chip
            testId="risk-council-reterm-chip-cannot-execute"
            color={NEGATIVE_RED}
            bg="rgba(178,0,0,0.06)"
            border="rgba(178,0,0,0.3)"
          >
            Trustee cannot execute
          </Chip>
        </div>

        <div className="flex w-full flex-col gap-[20px] pt-[8px] lg:flex-row lg:items-start">
          <CurrentTermsCard current={view.current} />
          <ProposedTermsCard proposed={view.proposed} />
        </div>

        <div
          data-testid="risk-council-reterm-footer"
          className="mt-[6px] flex flex-col items-start justify-between gap-[16px] rounded-[4px] px-[19px] py-[16px] sm:flex-row sm:items-center"
          style={{
            backgroundColor: "rgba(211,235,117,0.16)",
            border: `1px solid ${LINE_COLOR}`,
          }}
        >
          <p
            className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
            style={{ color: INK }}
          >
            Execution path stays with Risk Council Safe after timelock. Trustee
            dashboard only shows review, evidence, and voting status.
          </p>
          {/* Placeholder for the (unbuilt) Safe link — read-only, no wallet /
              no network. */}
          <button
            type="button"
            data-testid="risk-council-reterm-view-safe"
            disabled
            className="flex h-[48px] shrink-0 items-center justify-center rounded-[4px] px-[24px] text-center font-[family-name:var(--font-body)] text-[16px] leading-[19px] text-white disabled:cursor-not-allowed disabled:opacity-70"
            style={{ backgroundColor: BRAND }}
          >
            View Safe proposal
          </button>
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/risk-council/reterm/$id")({
  component: RiskCouncilReterm,
});

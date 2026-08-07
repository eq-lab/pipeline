import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useRiskCouncilWritedown,
  type ClosePayload,
  type SignerStatus,
} from "./-risk-council-writedown";
import { InlineError } from "@pipeline/ui";

/**
 * Risk Council — Write-down close (Default resolution) — issue #782, Figma node
 * `4116-13625`. The THIRD of the three Type-3 RISK_COUNCIL proposal screens
 * (spec `docs/product-specs/trustee-dashboard.md` §"Type 3", flow 12).
 *
 * A **read-only REVIEW** page with NO action at all — "trustee has no direct
 * close button on this flow"; the Risk Council Safe executes after the
 * timelock, GUARDIAN-cancelable. Registered under the `/risk-council`
 * pass-through layout at `/risk-council/writedown/$id`. Per `docs/FRONTEND.md`
 * rule 2 this `.tsx` is JSX/styling only; the real-vs-mock split lives in the
 * colocated `-risk-council-writedown.ts` view-model.
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

// ── Left card — Resolution summary ──────────────────────────────────────────

function ResolutionCard({
  loan,
  principalOutstanding,
  recoveryReceived,
  writeDownAmount,
}: {
  loan: string;
  principalOutstanding: string;
  recoveryReceived: string;
  writeDownAmount: string;
}) {
  return (
    <div
      data-testid="risk-council-writedown-resolution"
      className="flex w-full flex-1 flex-col rounded-[4px] bg-white px-[26px] py-[24px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      <h2 className="pb-[6px] font-[family-name:var(--font-display)] text-[26px] leading-[35.84px] text-[#262524]">
        Resolution summary
      </h2>
      <div>
        <TermRow
          label="Loan"
          value={loan}
          testId="risk-council-writedown-loan"
        />
        <TermRow
          label="Principal outstanding"
          value={principalOutstanding}
          testId="risk-council-writedown-principal"
        />
        <TermRow label="Recovery received" value={recoveryReceived} />
        <TermRow label="Write-down amount" value={writeDownAmount} isLast />
      </div>
      <div className="flex flex-wrap items-center gap-[8px] pt-[16px]">
        <DotTag label="principal ledger" dotColor={BRAND} />
        <DotTag label="recovery docs" dotColor={ATTENTION_AMBER} />
      </div>
    </div>
  );
}

// ── Right card — Close payload + signer voting ──────────────────────────────

function SignerRow({
  signer,
  isLast,
}: {
  signer: SignerStatus;
  isLast: boolean;
}) {
  return (
    <div
      data-testid="risk-council-writedown-signer"
      className="flex items-center justify-between gap-[16px] py-[12px]"
      style={isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }}
    >
      <span className="flex items-center gap-[10px] font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
        <span
          aria-hidden="true"
          className="inline-block size-[9px] rounded-full"
          style={{
            backgroundColor: signer.signed ? POSITIVE_GREEN : INK_SUBTLE,
          }}
        />
        {signer.name}
      </span>
      <span
        className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
        style={{ color: signer.signed ? POSITIVE_GREEN : INK_MUTED }}
      >
        {signer.signed ? "signed" : "pending"}
      </span>
    </div>
  );
}

function ClosePayloadCard({
  payload,
  signers,
}: {
  payload: ClosePayload;
  signers: SignerStatus[];
}) {
  return (
    <div
      data-testid="risk-council-writedown-payload"
      className="flex w-full flex-1 flex-col rounded-[4px] bg-white px-[26px] py-[24px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      <h2 className="pb-[12px] font-[family-name:var(--font-display)] text-[26px] leading-[35.84px] text-[#262524]">
        Close payload
      </h2>
      <pre
        data-testid="risk-council-writedown-code"
        className="overflow-auto rounded-[4px] bg-[#000040] px-[16px] py-[16px] font-mono text-[12.7px] leading-[22.1px] whitespace-pre-wrap"
      >
        <span style={{ color: "#9fd0ff" }}>closeLoan</span>
        <span style={{ color: "#e2e2f5" }}>{"(loanId: "}</span>
        <span style={{ color: "#c8e6a0" }}>{payload.loanId}</span>
        <span style={{ color: "#e2e2f5" }}>,{"\n  reason: "}</span>
        <span style={{ color: "#c8e6a0" }}>{payload.reason}</span>
        <span style={{ color: "#e2e2f5" }}>,{"\n  recoveryAmount: "}</span>
        <span style={{ color: "#c8e6a0" }}>{payload.recoveryAmount}</span>
        <span style={{ color: "#e2e2f5" }}>,{"\n  writeDown: "}</span>
        <span style={{ color: "#c8e6a0" }}>{payload.writeDown}</span>
        <span style={{ color: "#e2e2f5" }}>{")"}</span>
      </pre>
      <div className="pt-[10px]">
        {signers.map((signer, i) => (
          <SignerRow
            key={signer.name}
            signer={signer}
            isLast={i === signers.length - 1}
          />
        ))}
      </div>
    </div>
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

function RiskCouncilWritedown() {
  const { id } = Route.useParams();
  const view = useRiskCouncilWritedown(id);

  if (view.state === "error") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
        <BackLink />
        <div
          data-testid="risk-council-writedown-error"
          className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
        >
          <InlineError
            message={view.errorMessage ?? "Failed to load the loan."}
            details={view.errorDetails ?? undefined}
          />
        </div>
      </main>
    );
  }

  if (view.state === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
        <div
          data-testid="risk-council-writedown-loading"
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
          data-testid="risk-council-writedown-not-found"
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
          data-testid="risk-council-writedown-timestamp"
          className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
          style={{ color: INK_MUTED }}
        >
          {view.timestamp}
        </span>
      </div>

      <div
        data-testid="risk-council-writedown-card"
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
          Write-down close — Default resolution
        </h2>

        <div className="flex flex-wrap items-center gap-[8px]">
          <Chip
            testId="risk-council-writedown-chip-queue"
            color={ATTENTION_AMBER}
            bg="rgba(211,235,117,0.16)"
            border={LINE_COLOR}
          >
            {view.queueStatus}
          </Chip>
          <Chip
            testId="risk-council-writedown-chip-safe"
            color={BRAND}
            bg="rgba(0,0,128,0.06)"
            border="rgba(0,0,128,0.3)"
          >
            Safe proposal
          </Chip>
          <Chip
            testId="risk-council-writedown-chip-guardian"
            color={NEGATIVE_RED}
            bg="rgba(178,0,0,0.06)"
            border="rgba(178,0,0,0.3)"
          >
            Guardian cancel enabled
          </Chip>
        </div>

        <div className="flex w-full flex-col gap-[20px] pt-[8px] lg:flex-row lg:items-start">
          <ResolutionCard
            loan={view.loan}
            principalOutstanding={view.principalOutstanding}
            recoveryReceived={view.recoveryReceived}
            writeDownAmount={view.writeDownAmount}
          />
          <ClosePayloadCard
            payload={view.closePayload}
            signers={view.signers}
          />
        </div>

        <div
          data-testid="risk-council-writedown-footer"
          className="mt-[6px] rounded-[4px] px-[19px] py-[16px]"
          style={{
            backgroundColor: "rgba(191,189,187,0.12)",
            border: `1px solid ${LINE_COLOR}`,
          }}
        >
          <p
            className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
            style={{ color: INK }}
          >
            PLUSD backing impact and audit trail are shown before execution;
            trustee has no direct close button on this flow.
          </p>
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/risk-council/writedown/$id")({
  component: RiskCouncilWritedown,
});

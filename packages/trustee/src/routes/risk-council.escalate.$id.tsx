import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useRiskCouncilEscalate,
  type LedgerView,
  type PortfolioImpactView,
} from "./-risk-council-escalate";
import type { CcrBand } from "./-useLoansTable";
import type { CcrTrend } from "./-useLoanDetail";
import { CcrTrendChart } from "./-CcrTrendChart";

/**
 * Risk Council — Escalate (issue #782; Figma node `4116-12953` for styling) —
 * the destination opened by clicking the "Escalate to Risk Council"
 * other-action on the loan-detail page (`loans.$id.tsx`).
 *
 * This is the **proposal builder** (`docs/product-specs/trustee-risk-watchlist.md`):
 * the Trustee reviews the loan's risk evidence (left card) and writes a
 * free-form proposal name + text for the Risk Council (right card), rather than
 * a type-specific `setDefault` payload — see `-risk-council-escalate.ts`'s
 * module doc for the full real-vs-mock breakdown. The read-only re-term /
 * write-down frames (`4116-13481` / `4116-13625`) are the Risk-Council display
 * screens (`risk-council.reterm.$id.tsx` / `risk-council.writedown.$id.tsx`).
 *
 * Registered as a child of the `/risk-council` pass-through layout
 * (`risk-council.tsx`'s `<Outlet/>`) at `/risk-council/escalate/$id` — no
 * `$id_` trailing-underscore escape is needed here (unlike
 * `loans.$id_.record-coupon.tsx`) because there is no `risk-council.escalate.tsx`
 * leaf file it would otherwise collide with.
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, this `.tsx` is JSX/styling
 * only; all data wiring + value→display mapping lives in the colocated
 * `-risk-council-escalate.ts` view-model hook (mirrors `loans.$id_.record-coupon.tsx`
 * / `-record-coupon.ts`).
 */

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
const INK = "var(--color-pipeline-ink)";
const INK_MUTED = "rgba(56,55,53,0.6)";
const NEGATIVE_RED = "#b20000";
const ATTENTION_AMBER = "#6e6400";
const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";
const BRAND = "var(--color-pipeline-brand)";

const CARD_CLASS =
  "flex w-full flex-1 flex-col rounded-[4px] bg-[color:var(--color-pipeline-surface)]";

function cardStyle() {
  return { border: `1px solid ${LINE_COLOR}` } as const;
}

/** CCR band → text colour, matching the Loans-page / Loan-detail one-offs. */
function ccrBandColor(band: CcrBand | null): string {
  switch (band) {
    case "healthy":
      return POSITIVE_GREEN;
    case "attention":
      return ATTENTION_AMBER;
    case "pre-default":
      return NEGATIVE_RED;
    default:
      return INK;
  }
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
      {children}
    </h2>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-[17px] pb-[9px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] text-[color:var(--color-pipeline-ink-muted)] uppercase">
      {children}
    </p>
  );
}

function LedgerRow({
  label,
  value,
  valueColor,
  isLast,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
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
        style={{ color: valueColor ?? INK }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Left card — Loan ledger & deterioration ─────────────────────────────────

function LedgerCard({
  ledger,
  portfolioImpact,
  ccrTrend,
}: {
  ledger: LedgerView;
  portfolioImpact: PortfolioImpactView;
  ccrTrend: CcrTrend | null;
}) {
  return (
    <div
      data-testid="risk-council-escalate-ledger"
      className={`${CARD_CLASS} gap-0 px-[27px] py-[25px]`}
      style={cardStyle()}
    >
      <div className="pb-[6px]">
        <CardTitle>Loan ledger &amp; deterioration</CardTitle>
      </div>
      <LedgerRow
        label="Facility / senior deployed"
        value={ledger.facilityAndSeniorDeployed}
        testId="risk-council-escalate-facility"
      />
      <LedgerRow
        label="Repaid to date"
        value={ledger.repaidToDate}
        testId="risk-council-escalate-repaid"
      />
      <LedgerRow
        label={ledger.collateralLabel}
        value={ledger.collateralValue}
        testId="risk-council-escalate-collateral"
      />
      <LedgerRow
        label="CCR"
        value={ledger.ccrLine}
        valueColor={ccrBandColor(ledger.ccrBand)}
        testId="risk-council-escalate-ccr"
      />
      <LedgerRow
        label="Days on watchlist"
        value={ledger.daysOnWatchlist}
        isLast
        testId="risk-council-escalate-days-on-watchlist"
      />

      <SectionLabel>CCR trend — thresholds 130 / 120 / 110%</SectionLabel>
      {ccrTrend && (
        <div data-testid="risk-council-escalate-ccr-trend">
          <CcrTrendChart trend={ccrTrend} />
        </div>
      )}

      <SectionLabel>Portfolio impact if defaulted</SectionLabel>
      <LedgerRow
        label="At-risk (Watchlist + Default)"
        testId="risk-council-escalate-at-risk"
        value={
          <>
            {portfolioImpact.atRiskCurrentPct} →{" "}
            {/* The if-defaulted projection is a MOCK figure (no endpoint) —
                see `-risk-council-escalate.ts`'s module doc — rendered red
                per the Figma. */}
            <span style={{ color: NEGATIVE_RED }}>
              {portfolioImpact.atRiskProjectedPct}
            </span>{" "}
            of deployed
          </>
        }
      />
      <LedgerRow
        label={portfolioImpact.concentrationLabel}
        value={portfolioImpact.concentrationValue}
        testId="risk-council-escalate-concentration"
        isLast
      />
    </div>
  );
}

// ── Right card — Proposal ────────────────────────────────────────────────────

function CheckIcon(props: React.SVGAttributes<SVGSVGElement>) {
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
        d="M3 8.5L6.2 11.5L13 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const GUARDRAILS = [
  "Goes to the 3-of-5 RISK_COUNCIL Safe",
  "24h timelock starts at submission",
  "GUARDIAN can cancel during the window",
];

const FIELD_CLASS =
  "w-full rounded-[4px] border border-solid px-[13px] py-[10px] font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[#262524] outline-none disabled:cursor-not-allowed disabled:opacity-70";

/**
 * The proposal builder (Risk & Watchlist spec) — the Trustee writes a free-form
 * proposal name + text for the Risk Council; the Safe composes/executes the
 * actual on-chain action. Local mock Draft → Submitted state, no wallet/network.
 */
function ProposalBuilderCard({
  proposalName,
  proposalText,
  onNameChange,
  onTextChange,
  canSubmit,
  status,
  onSubmit,
}: {
  proposalName: string;
  proposalText: string;
  onNameChange: (value: string) => void;
  onTextChange: (value: string) => void;
  canSubmit: boolean;
  status: "draft" | "submitted";
  onSubmit: () => void;
}) {
  const submitted = status === "submitted";
  return (
    <div
      data-testid="risk-council-escalate-proposal"
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
    >
      <CardTitle>Proposal</CardTitle>
      <p className="font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
        For the 3-of-5 RISK_COUNCIL Safe · 24h timelock · GUARDIAN-cancelable
      </p>

      <label className="flex flex-col gap-[6px]">
        <span
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
          style={{ color: INK_MUTED }}
        >
          Proposal name
        </span>
        <input
          type="text"
          data-testid="risk-council-escalate-name"
          value={proposalName}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={submitted}
          placeholder="e.g. Escalate to Default — recovery exhausted"
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
      </label>

      <label className="flex flex-col gap-[6px]">
        <span
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
          style={{ color: INK_MUTED }}
        >
          Proposal text
        </span>
        <textarea
          data-testid="risk-council-escalate-text"
          value={proposalText}
          onChange={(e) => onTextChange(e.target.value)}
          disabled={submitted}
          rows={5}
          placeholder="Describe the condition and the action you are asking the Risk Council to take…"
          className={`${FIELD_CLASS} min-h-[110px] resize-y`}
          style={{ borderColor: LINE_COLOR }}
        />
      </label>

      <ul
        data-testid="risk-council-escalate-checklist"
        className="flex flex-col gap-0"
      >
        {GUARDRAILS.map((item) => (
          <li
            key={item}
            className="flex items-center gap-[10px] py-[6px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
            style={{ color: INK_MUTED }}
          >
            <CheckIcon style={{ color: INK_MUTED, flexShrink: 0 }} />
            {item}
          </li>
        ))}
      </ul>

      <button
        type="button"
        data-testid="risk-council-escalate-submit"
        onClick={onSubmit}
        disabled={submitted || !canSubmit}
        className="flex h-[48px] items-center justify-center rounded-[4px] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-70"
        style={{ backgroundColor: BRAND }}
      >
        {submitted ? "Submitted · 24h timelock" : "Escalate to council"}
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function RiskCouncilEscalate() {
  const { id } = Route.useParams();
  const view = useRiskCouncilEscalate(id);

  if (view.state === "error") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
        <Link
          to="/risk-council"
          className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
        >
          ‹ Risk Council
        </Link>
        <div
          role="alert"
          data-testid="risk-council-escalate-error"
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
          data-testid="risk-council-escalate-loading"
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
          data-testid="risk-council-escalate-not-found"
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
      <Link
        to="/risk-council"
        className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
      >
        ‹ Risk Council
      </Link>
      <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
        {view.title}
      </h1>
      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        <span
          data-testid="risk-council-escalate-timelock-chip"
          className="inline-flex items-center rounded-[4px] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
          style={{
            backgroundColor: "rgba(191,189,187,0.12)",
            color: INK_MUTED,
          }}
        >
          Risk Council Safe · 24h timelock
        </span>
        <span
          data-testid="risk-council-escalate-status-chip"
          className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
          style={
            view.status === "submitted"
              ? {
                  color: POSITIVE_GREEN,
                  backgroundColor: "rgba(32,128,0,0.08)",
                  borderColor: "rgba(32,128,0,0.3)",
                }
              : {
                  color: ATTENTION_AMBER,
                  backgroundColor: "rgba(211,235,117,0.16)",
                  borderColor: LINE_COLOR,
                }
          }
        >
          {view.status === "submitted" ? "Submitted" : "Draft"}
        </span>
      </div>

      <div className="flex w-full flex-col gap-[20px] pt-[16px] lg:flex-row lg:items-start lg:justify-center">
        <LedgerCard
          ledger={view.ledger}
          portfolioImpact={view.portfolioImpact}
          ccrTrend={view.ccrTrend}
        />
        <ProposalBuilderCard
          proposalName={view.proposalName}
          proposalText={view.proposalText}
          onNameChange={view.onNameChange}
          onTextChange={view.onTextChange}
          canSubmit={view.canSubmit}
          status={view.status}
          onSubmit={view.onSubmit}
        />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/risk-council/escalate/$id")({
  component: RiskCouncilEscalate,
});

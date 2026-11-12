// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { createFileRoute, Link } from "@tanstack/react-router";
import { parseLoanRouteSearch } from "@/lib/loanRoute";
import {
  useRiskCouncilEscalate,
  type LedgerView,
  type PortfolioImpactView,
  type RiskCouncilEscalateView,
} from "./-risk-council-escalate";
import {
  ActionControls,
  BackLink,
  Card,
  ChainStateRows,
  Chip,
  INK,
  MAIN_CLASS,
  Muted,
  PageGate,
  Row,
} from "./-RiskCouncilParts";

const TONE_COLOR = {
  negative: "#b20000",
  attention: "#6e6400",
  neutral: INK,
} as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-[17px] pb-[9px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] text-[color:var(--color-pipeline-ink-muted)] uppercase">
      {children}
    </p>
  );
}

function LedgerCard({
  ledger,
  portfolioImpact,
}: {
  ledger: LedgerView;
  portfolioImpact: PortfolioImpactView;
}) {
  return (
    <Card
      testId="risk-council-escalate-ledger"
      title="Loan ledger & deterioration"
    >
      <div>
        <Row
          label="Facility / senior deployed"
          value={ledger.facilityAndSeniorDeployed}
          testId="risk-council-escalate-facility"
        />
        <Row
          label="Principal repaid"
          value={ledger.principalRepaid}
          testId="risk-council-escalate-repaid"
        />
        {ledger.security && (
          <>
            <Row
              label="Security value"
              value={ledger.security.value}
              testId="risk-council-escalate-security-value"
            />
            <Row
              label="LTV"
              value={ledger.security.ltvLine}
              valueColor={TONE_COLOR[ledger.security.ltvTone]}
              testId="risk-council-escalate-ltv"
            />
            <Row
              label="Advance / margin-call ratio"
              value={ledger.security.ratios}
              testId="risk-council-escalate-ratios"
            />
            {ledger.security.priceStale && (
              <Row
                label="Price stale"
                value="Yes"
                valueColor={TONE_COLOR.attention}
                testId="risk-council-escalate-price-stale"
              />
            )}
          </>
        )}
        <Row
          label="Days on watchlist"
          value={ledger.daysOnWatchlist}
          isLast
          testId="risk-council-escalate-days-on-watchlist"
        />
      </div>

      <SectionLabel>Portfolio</SectionLabel>
      <Row
        label="At-risk (Watchlist + Default)"
        testId="risk-council-escalate-at-risk"
        value={`${portfolioImpact.atRiskCurrentPct} of deployed`}
      />
      <Row
        label={portfolioImpact.concentrationLabel}
        value={portfolioImpact.concentrationValue}
        testId="risk-council-escalate-concentration"
        isLast
      />
    </Card>
  );
}

function EligibilityLine({
  view,
  id,
  chain,
}: {
  view: RiskCouncilEscalateView;
  id: string;
  chain: number;
}) {
  const { eligibility } = view;
  if (eligibility.kind === "default") {
    return (
      <Muted testId="risk-council-escalate-eligibility">
        This loan is in Default.{" "}
        <Link
          to="/risk-council/writedown/$id"
          params={{ id }}
          search={{ chain }}
          className="text-[#000080] underline"
        >
          Resolve the default →
        </Link>
      </Muted>
    );
  }
  if (eligibility.kind === "unavailable") {
    return (
      <Muted testId="risk-council-escalate-eligibility">
        {eligibility.note}
      </Muted>
    );
  }
  return null;
}

function DeclareDefaultCard({
  view,
  id,
  chain,
}: {
  view: RiskCouncilEscalateView;
  id: string;
  chain: number;
}) {
  return (
    <Card testId="risk-council-escalate-declare" title="Declare default">
      <Muted testId="risk-council-escalate-effects">{view.effects}</Muted>
      <EligibilityLine view={view} id={id} chain={chain} />
      <ActionControls
        prefix="risk-council-escalate"
        view={view.action}
        confirmText={`Declare default on Loan #${id}? The pocket opens on the first default.`}
      />
      <ChainStateRows
        rows={view.chainState}
        testId="risk-council-escalate-chain-state"
      />
      <Link
        to="/risk-council/reterm/$id"
        params={{ id }}
        search={{ chain }}
        className="self-start text-[14px] text-[#000080] underline"
      >
        Amend economics →
      </Link>
    </Card>
  );
}

function RiskCouncilEscalate() {
  const { id } = Route.useParams();
  const { chain } = Route.useSearch();
  const view = useRiskCouncilEscalate(chain, id);

  return (
    <PageGate
      state={view.state}
      errorMessage={view.errorMessage}
      errorDetails={view.errorDetails}
      prefix="risk-council-escalate"
    >
      <main className={MAIN_CLASS}>
        <BackLink />
        <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
          {view.title}
        </h1>
        {view.action.chip && (
          <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
            <Chip testId="risk-council-escalate-chip">{view.action.chip}</Chip>
          </div>
        )}

        <div className="flex w-full flex-col gap-[20px] pt-[16px] lg:flex-row lg:items-start lg:justify-center">
          <LedgerCard
            ledger={view.ledger}
            portfolioImpact={view.portfolioImpact}
          />
          <DeclareDefaultCard view={view} id={id} chain={chain} />
        </div>
      </main>
    </PageGate>
  );
}

export const Route = createFileRoute("/risk-council/escalate/$id")({
  validateSearch: parseLoanRouteSearch,
  component: RiskCouncilEscalate,
});

// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { createFileRoute } from "@tanstack/react-router";
import { parseLoanRouteSearch } from "@/lib/loanRoute";
import {
  useRiskCouncilReterm,
  type AdjustFormView,
  type AmendFormView,
  type RetermCurrentTerms,
} from "./-risk-council-reterm";
import {
  ActionControls,
  BackLink,
  Card,
  Chip,
  FIELD_CLASS,
  Field,
  INK_MUTED,
  LINE_COLOR,
  MAIN_CLASS,
  Muted,
  PageGate,
  Row,
} from "./-RiskCouncilParts";

function CurrentTermsCard({ current }: { current: RetermCurrentTerms }) {
  return (
    <Card testId="risk-council-reterm-current" title="Current terms">
      <div>
        <Row
          label="Loan"
          value={current.loan}
          testId="risk-council-reterm-loan"
        />
        <Row
          label="Coupon"
          value={current.coupon}
          testId="risk-council-reterm-coupon"
        />
        <Row
          label="Maturity"
          value={current.maturity}
          testId="risk-council-reterm-maturity"
        />
        {current.ltv != null && (
          <Row
            label="LTV"
            value={current.ltv}
            testId="risk-council-reterm-ltv"
          />
        )}
        <Row
          label="Accrued interest"
          value={current.accruedInterest}
          testId="risk-council-reterm-accrued"
        />
        <Row
          label="Interest adjustment"
          value={current.interestAdjustment}
          testId="risk-council-reterm-adjustment"
          isLast
        />
      </div>
    </Card>
  );
}

function AmendEconomicsCard({ form }: { form: AmendFormView }) {
  return (
    <Card testId="risk-council-reterm-amend" title="Amend economics">
      <Field label="New rate (%)">
        <input
          type="text"
          inputMode="decimal"
          data-testid="risk-council-reterm-rate"
          value={form.ratePercent}
          onChange={(e) => form.setRatePercent(e.target.value)}
          placeholder="e.g. 14.5"
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
        <span
          data-testid="risk-council-reterm-rate-bps"
          className="font-[family-name:var(--font-body)] text-[12px]"
          style={{ color: INK_MUTED }}
        >
          {form.bps !== null ? `= ${form.bps} bps` : "1 bp = 0.01%"}
        </span>
        {form.rateInvalid && (
          <span
            data-testid="risk-council-reterm-rate-error"
            role="alert"
            className="font-[family-name:var(--font-body)] text-[12px] text-[color:var(--color-pipeline-negative)]"
          >
            Enter a rate between 0.01% and 100% with at most two decimals.
          </span>
        )}
      </Field>
      <Field label="New maturity">
        <input
          type="date"
          data-testid="risk-council-reterm-maturity-input"
          value={form.maturityDate}
          onChange={(e) => form.setMaturityDate(e.target.value)}
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
      </Field>
      <ActionControls prefix="risk-council-reterm-amend" view={form.action} />
    </Card>
  );
}

function AdjustInterestCard({ form }: { form: AdjustFormView }) {
  return (
    <Card testId="risk-council-reterm-adjust" title="Adjust interest">
      <Field label="Delta (USD, negative = waiver)">
        <input
          type="text"
          inputMode="decimal"
          data-testid="risk-council-reterm-delta"
          value={form.deltaUsd}
          onChange={(e) => form.setDeltaUsd(e.target.value)}
          placeholder="e.g. -1,000.50"
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
        {form.deltaInvalid && (
          <span
            data-testid="risk-council-reterm-delta-error"
            role="alert"
            className="font-[family-name:var(--font-body)] text-[12px] text-[color:var(--color-pipeline-negative)]"
          >
            Enter a non-zero USD amount, with an optional leading minus.
          </span>
        )}
      </Field>
      <Field label="Reason">
        <input
          type="text"
          data-testid="risk-council-reterm-reason"
          value={form.reason}
          onChange={(e) => form.setReason(e.target.value)}
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
      </Field>
      <Field label="Reason hash (sha256)">
        <input
          type="text"
          readOnly
          data-testid="risk-council-reterm-reason-hash"
          value={form.reasonHash ?? ""}
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
      </Field>
      <ActionControls prefix="risk-council-reterm-adjust" view={form.action} />
    </Card>
  );
}

function RiskCouncilReterm() {
  const { id } = Route.useParams();
  const { chain } = Route.useSearch();
  const view = useRiskCouncilReterm(chain, id);

  return (
    <PageGate
      state={view.state}
      errorMessage={view.errorMessage}
      errorDetails={view.errorDetails}
      prefix="risk-council-reterm"
    >
      <main className={MAIN_CLASS}>
        <BackLink />
        <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
          Amend economics — off-cycle re-term
        </h1>
        {view.amend.action.chip && (
          <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
            <Chip testId="risk-council-reterm-chip">
              {view.amend.action.chip}
            </Chip>
          </div>
        )}
        {view.eligibilityNote && (
          <Muted testId="risk-council-reterm-eligibility">
            {view.eligibilityNote}
          </Muted>
        )}
        <div className="flex w-full flex-col gap-[20px] pt-[16px] lg:flex-row lg:items-start">
          <CurrentTermsCard current={view.current} />
          <div className="flex w-full flex-1 flex-col gap-[20px]">
            <AmendEconomicsCard form={view.amend} />
            <AdjustInterestCard form={view.adjust} />
          </div>
        </div>
      </main>
    </PageGate>
  );
}

export const Route = createFileRoute("/risk-council/reterm/$id")({
  validateSearch: parseLoanRouteSearch,
  component: RiskCouncilReterm,
});

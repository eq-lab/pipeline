// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { createFileRoute, Link } from "@tanstack/react-router";
import { parseLoanRouteSearch } from "@/lib/loanRoute";
import {
  CLOSURE_TABLE,
  NOT_IN_DEFAULT,
  useRiskCouncilWritedown,
  type CloseView,
  type WriteDownView,
} from "./-risk-council-writedown";
import {
  ActionControls,
  BackLink,
  Card,
  ChainStateRows,
  Chip,
  FIELD_CLASS,
  Field,
  INK,
  INK_MUTED,
  LINE_COLOR,
  MAIN_CLASS,
  Muted,
  PageGate,
} from "./-RiskCouncilParts";

function WriteDownCard({ form }: { form: WriteDownView }) {
  return (
    <Card testId="risk-council-writedown-writedown" title="Write down">
      <Muted>
        Burns the written-down PLUSD in the pocket. A write-down is final.
      </Muted>
      <Field label="Amount (USD)">
        <input
          type="text"
          inputMode="decimal"
          data-testid="risk-council-writedown-amount"
          value={form.amountInput}
          onChange={(e) => form.setAmountInput(e.target.value)}
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
      </Field>
      <ActionControls
        prefix="risk-council-writedown-writedown"
        view={form.action}
      />
    </Card>
  );
}

function CloseCard({ form }: { form: CloseView }) {
  return (
    <Card testId="risk-council-writedown-close" title="Close defaulted loan">
      <fieldset className="flex flex-col gap-[6px]">
        <legend
          className="pb-[6px] font-[family-name:var(--font-body)] text-[12px]"
          style={{ color: INK_MUTED }}
        >
          Closure reason
        </legend>
        {CLOSURE_TABLE.map((row) => (
          <label
            key={row.reason}
            className="flex items-center gap-[8px] font-[family-name:var(--font-body)] text-[15px]"
            style={{ color: INK }}
          >
            <input
              type="radio"
              name="closure-reason"
              data-testid={`risk-council-writedown-reason-${row.reason}`}
              checked={form.reason === row.reason}
              onChange={() => form.setReason(row.reason)}
            />
            {row.label}
            <span style={{ color: INK_MUTED }}>
              {" "}
              — {row.who} · {row.delay}
            </span>
          </label>
        ))}
      </fieldset>
      <ActionControls
        prefix="risk-council-writedown-close"
        view={form.action}
      />
    </Card>
  );
}

function CureCard({
  effects,
  view,
}: {
  effects: string;
  view: Parameters<typeof ActionControls>[0]["view"];
}) {
  return (
    <Card testId="risk-council-writedown-cure" title="Cure">
      <Muted testId="risk-council-writedown-cure-effects">{effects}</Muted>
      <ActionControls prefix="risk-council-writedown-cure" view={view} />
    </Card>
  );
}

function RiskCouncilWritedown() {
  const { id } = Route.useParams();
  const { chain } = Route.useSearch();
  const view = useRiskCouncilWritedown(chain, id);

  return (
    <PageGate
      state={view.state}
      errorMessage={view.errorMessage}
      errorDetails={view.errorDetails}
      prefix="risk-council-writedown"
    >
      <main className={MAIN_CLASS}>
        <BackLink />
        <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
          Default resolution — {view.loan}
        </h1>
        {view.writeDown.action.chip && (
          <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
            <Chip testId="risk-council-writedown-chip">
              {view.writeDown.action.chip}
            </Chip>
          </div>
        )}
        {view.notInDefault && (
          <Muted testId="risk-council-writedown-not-default">
            {NOT_IN_DEFAULT}{" "}
            <Link
              to="/risk-council/escalate/$id"
              params={{ id }}
              search={{ chain }}
              className="text-[#000080] underline"
            >
              Back to Escalate to Default →
            </Link>
          </Muted>
        )}
        <div className="flex w-full flex-col gap-[20px] pt-[16px] lg:flex-row lg:items-start">
          <Card testId="risk-council-writedown-state" title="Chain state">
            <ChainStateRows
              rows={view.chainState}
              testId="risk-council-writedown-chain-state"
            />
          </Card>
          <div className="flex w-full flex-1 flex-col gap-[20px]">
            <WriteDownCard form={view.writeDown} />
            <CloseCard form={view.close} />
            <CureCard effects={view.cure.effects} view={view.cure.action} />
          </div>
        </div>
      </main>
    </PageGate>
  );
}

export const Route = createFileRoute("/risk-council/writedown/$id")({
  validateSearch: parseLoanRouteSearch,
  component: RiskCouncilWritedown,
});

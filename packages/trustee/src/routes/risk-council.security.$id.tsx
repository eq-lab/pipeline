// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { createFileRoute } from "@tanstack/react-router";
import {
  FLAG_OUTCOMES,
  SECURITY_PAYMENT_TERMS,
} from "@pipeline/wallet-connect";
import { parseLoanRouteSearch } from "@/lib/loanRoute";
import {
  NO_FLAGGED_RECORDS,
  NO_OPEN_RECORDS,
  NO_SECURITY_TERMS,
  OUTCOME_EFFECTS,
  PAYMENT_TERM_LABELS,
  RELEASE_WARNING,
  TERMS_FIELDS,
  useResolveFlagForm,
  useRiskCouncilSecurity,
  type FlaggedRecordRow,
  type ReleaseFormView,
  type RiskCouncilSecurityView,
  type SetTermsFormView,
} from "./-risk-council-security";
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

const ERROR_CLASS =
  "font-[family-name:var(--font-body)] text-[12px] text-[color:var(--color-pipeline-negative)]";

function CurrentTermsCard({ view }: { view: RiskCouncilSecurityView }) {
  return (
    <Card testId="risk-council-security-current" title="Current security terms">
      <Row
        label="Loan"
        value={view.loanLabel}
        testId="risk-council-security-loan"
      />
      {view.ltv != null && (
        <Row label="LTV" value={view.ltv} testId="risk-council-security-ltv" />
      )}
      {view.pausedNote && (
        <Muted testId="risk-council-security-paused">{view.pausedNote}</Muted>
      )}
      {view.refreshNote && (
        <Muted testId="risk-council-security-refresh">{view.refreshNote}</Muted>
      )}
      {view.hasTerms ? (
        <div data-testid="risk-council-security-terms">
          {view.termsRows.map((row, index) => (
            <Row
              key={row.label}
              label={row.label}
              value={row.value}
              isLast={index === view.termsRows.length - 1}
            />
          ))}
        </div>
      ) : (
        <Muted testId="risk-council-security-no-terms">
          {view.securityLoading ? "Loading…" : NO_SECURITY_TERMS}
        </Muted>
      )}
    </Card>
  );
}

function SetTermsCard({ form }: { form: SetTermsFormView }) {
  return (
    <Card testId="risk-council-security-set-terms" title="Set terms">
      {TERMS_FIELDS.map(({ key, label, placeholder }) => {
        const state = form.echoes[key];
        return (
          <Field key={key} label={label}>
            <input
              type="text"
              inputMode="decimal"
              data-testid={`risk-council-security-terms-${key}`}
              value={form.values[key]}
              onChange={(e) => form.setField(key, e.target.value)}
              placeholder={placeholder}
              className={FIELD_CLASS}
              style={{ borderColor: LINE_COLOR }}
            />
            {state.echo && (
              <span
                data-testid={`risk-council-security-terms-${key}-echo`}
                className="font-[family-name:var(--font-body)] text-[12px]"
                style={{ color: INK_MUTED }}
              >
                {state.echo}
              </span>
            )}
            {state.invalid && (
              <span
                data-testid={`risk-council-security-terms-${key}-error`}
                role="alert"
                className={ERROR_CLASS}
              >
                Enter a valid non-negative value in the unit shown.
              </span>
            )}
          </Field>
        );
      })}
      <Field label="Payment term">
        <select
          data-testid="risk-council-security-terms-paymentTerm"
          value={form.values.paymentTerm}
          onChange={(e) =>
            form.setPaymentTerm(
              e.target.value as (typeof SECURITY_PAYMENT_TERMS)[number] | "",
            )
          }
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        >
          <option value="">Select…</option>
          {SECURITY_PAYMENT_TERMS.map((term) => (
            <option key={term} value={term}>
              {PAYMENT_TERM_LABELS[term]}
            </option>
          ))}
        </select>
      </Field>
      {form.ratioOrderError && (
        <span
          data-testid="risk-council-security-terms-ratio-error"
          role="alert"
          className={ERROR_CLASS}
        >
          {form.ratioOrderError}
        </span>
      )}
      <ActionControls prefix="risk-council-security-terms" view={form.action} />
    </Card>
  );
}

function FlaggedRecord({
  row,
  chainId,
  loanNumber,
  executeGate,
}: {
  row: FlaggedRecordRow;
  chainId: number;
  loanNumber: number | null;
  executeGate: string | null;
}) {
  const form = useResolveFlagForm({
    chainId,
    loanId: loanNumber,
    recordNumber: row.recordNumber,
    executeGate,
  });
  const prefix = `risk-council-security-flag-${row.recordId}`;
  return (
    <div
      data-testid="risk-council-security-flag-row"
      className="flex flex-col gap-[10px] rounded-[4px] p-[14px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      <strong className="font-[family-name:var(--font-body)] text-[16px]">
        Record #{row.recordId} — {row.protection}, {row.commodity}, lot{" "}
        {row.lot}
      </strong>
      <div data-testid={`${prefix}-details`}>
        {row.flag.map((item, index) => (
          <Row
            key={item.label}
            label={item.label}
            value={item.value}
            isLast={index === row.flag.length - 1}
          />
        ))}
      </div>
      <fieldset className="flex flex-col gap-[6px]">
        <legend
          className="font-[family-name:var(--font-body)] text-[12px]"
          style={{ color: INK_MUTED }}
        >
          Outcome
        </legend>
        {FLAG_OUTCOMES.map((outcome) => (
          <label
            key={outcome}
            className="flex items-start gap-[8px] font-[family-name:var(--font-body)] text-[14px]"
          >
            <input
              type="radio"
              name={`${prefix}-outcome`}
              data-testid={`${prefix}-outcome-${outcome}`}
              checked={form.outcome === outcome}
              onChange={() => form.setOutcome(outcome)}
            />
            <span>
              <strong>{outcome}</strong> — {OUTCOME_EFFECTS[outcome]}
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Reason">
        <input
          type="text"
          data-testid={`${prefix}-reason`}
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
          data-testid={`${prefix}-reason-hash`}
          value={form.reasonHash ?? ""}
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
      </Field>
      <ActionControls prefix={prefix} view={form.action} />
    </div>
  );
}

function FlaggedCard({ view }: { view: RiskCouncilSecurityView }) {
  return (
    <Card testId="risk-council-security-flagged" title="Flagged records">
      {view.flagged.length === 0 ? (
        <Muted testId="risk-council-security-flagged-empty">
          {NO_FLAGGED_RECORDS}
        </Muted>
      ) : (
        view.flagged.map((row) => (
          <FlaggedRecord
            key={row.recordId}
            row={row}
            chainId={view.chainId}
            loanNumber={view.loanNumber}
            executeGate={view.executeGate}
          />
        ))
      )}
    </Card>
  );
}

function ReleaseCard({ form }: { form: ReleaseFormView }) {
  return (
    <Card testId="risk-council-security-release" title="Release with consent">
      {form.options.length === 0 ? (
        <Muted testId="risk-council-security-release-empty">
          {NO_OPEN_RECORDS}
        </Muted>
      ) : (
        <>
          <Field label="Record">
            <select
              data-testid="risk-council-security-release-record"
              value={form.selected}
              onChange={(e) => form.setSelected(e.target.value)}
              className={FIELD_CLASS}
              style={{ borderColor: LINE_COLOR }}
            >
              {form.options.map((option) => (
                <option key={option.recordId} value={option.recordId}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Consent reference">
            <input
              type="text"
              data-testid="risk-council-security-release-consent"
              value={form.consent}
              onChange={(e) => form.setConsent(e.target.value)}
              className={FIELD_CLASS}
              style={{ borderColor: LINE_COLOR }}
            />
          </Field>
          <Field label="Consent hash (sha256)">
            <input
              type="text"
              readOnly
              data-testid="risk-council-security-release-hash"
              value={form.consentHash ?? ""}
              className={FIELD_CLASS}
              style={{ borderColor: LINE_COLOR }}
            />
          </Field>
          <Muted testId="risk-council-security-release-warning">
            {RELEASE_WARNING}
          </Muted>
          <ActionControls
            prefix="risk-council-security-release"
            view={form.action}
            confirmText={form.confirmText ?? undefined}
          />
        </>
      )}
    </Card>
  );
}

function RiskCouncilSecurity() {
  const { id } = Route.useParams();
  const { chain } = Route.useSearch();
  const view = useRiskCouncilSecurity(chain, id);

  return (
    <PageGate
      state={view.state}
      errorMessage={view.errorMessage}
      errorDetails={view.errorDetails}
      prefix="risk-council-security"
    >
      <main className={MAIN_CLASS}>
        <BackLink />
        <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
          Security actions — terms, flags, consent release
        </h1>
        {view.setTerms.action.chip && (
          <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
            <Chip testId="risk-council-security-chip">
              {view.setTerms.action.chip}
            </Chip>
          </div>
        )}
        <div className="flex w-full flex-col gap-[20px] pt-[16px] lg:flex-row lg:items-start">
          <CurrentTermsCard view={view} />
          <div className="flex w-full flex-1 flex-col gap-[20px]">
            <SetTermsCard form={view.setTerms} />
            <FlaggedCard view={view} />
            <ReleaseCard form={view.release} />
          </div>
        </div>
      </main>
    </PageGate>
  );
}

export const Route = createFileRoute("/risk-council/security/$id")({
  validateSearch: parseLoanRouteSearch,
  component: RiskCouncilSecurity,
});

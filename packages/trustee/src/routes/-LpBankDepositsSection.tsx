// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { Button, InlineError } from "@pipeline/ui";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import {
  useLpBankDepositsSection,
  type LpBankDepositsSection as Section,
} from "./-useLpBankDeposits";

const inputClass =
  "rounded-pipeline-card border-pipeline-line bg-pipeline-surface text-pipeline-ink focus:border-pipeline-brand w-full border p-3 focus:outline-none disabled:opacity-50";

export function LpBankDepositsSection({
  lpId,
  legalName,
}: {
  lpId: number;
  legalName: string;
}) {
  const section = useLpBankDepositsSection(lpId);
  return (
    <section
      className="rounded-pipeline-card border-pipeline-line bg-pipeline-surface flex flex-col gap-4 border p-6"
      aria-labelledby="lp-deposits-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="lp-deposits-heading" className="font-display text-2xl">
          Bank deposits
        </h2>
        <Button
          variant="primary-dark"
          onClick={section.openDialog}
          disabled={section.busy}
        >
          Record deposit
        </Button>
      </div>
      {section.state === "loading" && (
        <p role="status">Loading bank deposits…</p>
      )}
      {section.error && (
        <div role="alert" className="flex flex-col gap-3">
          <InlineError
            message={section.error.message}
            details={section.error.details}
          />
          <Button
            variant="secondary"
            onClick={section.refresh}
            disabled={section.query.isFetching}
            className="w-fit"
          >
            Retry
          </Button>
        </div>
      )}
      {section.state === "empty" && (
        <p className="text-pipeline-ink-muted">No bank deposits recorded.</p>
      )}
      {section.state === "ready" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-pipeline-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-normal">Received</th>
                <th className="py-2 pr-4 text-right font-normal">Amount</th>
                <th className="py-2 pr-4 font-normal">Payment reference</th>
                <th className="py-2 pr-4 font-normal">PLUSD</th>
                <th className="py-2 font-normal">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-pipeline-line divide-y">
              {section.rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    {row.occurredAt}
                  </td>
                  <td className="py-3 pr-4 text-right whitespace-nowrap tabular-nums">
                    {row.amount}
                  </td>
                  <td className="py-3 pr-4 break-all" title={row.refHash}>
                    {row.reference}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">{row.minted}</td>
                  <td className="py-3 break-all">{row.recordedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.open && (
        <RecordBankDepositDialog section={section} legalName={legalName} />
      )}
    </section>
  );
}

function RecordBankDepositDialog({
  section,
  legalName,
}: {
  section: Section;
  legalName: string;
}) {
  const dialogRef = useLpReviewDialog<HTMLFormElement>(
    section.close,
    section.busy,
  );
  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={section.close}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lp-deposit-title"
        aria-describedby="lp-deposit-description"
        tabIndex={-1}
        noValidate
        className="rounded-pipeline-card-sm bg-pipeline-surface flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-y-auto p-7 shadow-xl outline-none"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void section.submit();
        }}
      >
        <h2
          id="lp-deposit-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Record deposit — {legalName}
        </h2>
        <p
          id="lp-deposit-description"
          className="text-pipeline-ink-muted text-sm"
        >
          Record a wire received from this LP. The payment reference must be
          unique — it identifies the wire when PLUSD is minted.
        </p>
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="lp-deposit-amount"
        >
          Amount (USD)
          <input
            id="lp-deposit-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="50000.00"
            value={section.amount}
            onChange={(event) => section.setAmount(event.target.value)}
            disabled={section.busy}
            className={inputClass}
          />
        </label>
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="lp-deposit-reference"
        >
          Payment reference
          <input
            id="lp-deposit-reference"
            autoComplete="off"
            value={section.reference}
            onChange={(event) => section.setReference(event.target.value)}
            disabled={section.busy}
            className={inputClass}
          />
        </label>
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="lp-deposit-occurred-at"
        >
          Received at (UTC)
          <input
            id="lp-deposit-occurred-at"
            type="datetime-local"
            value={section.occurredAt}
            onChange={(event) => section.setOccurredAt(event.target.value)}
            disabled={section.busy}
            className={inputClass}
          />
        </label>
        {section.validationError && (
          <p role="alert" className="text-pipeline-negative-strong text-sm">
            {section.validationError}
          </p>
        )}
        {section.mutationError && (
          <InlineError
            message={section.mutationError.message}
            details={section.mutationError.details}
          />
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={section.busy}
            onClick={section.close}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary-dark" disabled={section.busy}>
            {section.busy ? "Recording…" : "Record deposit"}
          </Button>
        </div>
      </form>
    </div>
  );
}

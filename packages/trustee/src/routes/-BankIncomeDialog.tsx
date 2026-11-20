// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { useEffect } from "react";
import { Button, InlineError } from "@pipeline/ui";
import {
  incomeStageLabel,
  type BankIncomeView,
} from "./-cash-management-income";

const INPUT_CLASS =
  "rounded-pipeline-card border-pipeline-line bg-pipeline-surface text-pipeline-ink focus:border-pipeline-brand w-full border p-3 focus:outline-none disabled:opacity-50";

export function BankIncomeDialog({ income }: { income: BankIncomeView }) {
  const { open, busy, close } = income;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open) return null;

  const blocked = income.submitReason !== null;

  return (
    <div
      data-testid="cash-management-income-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)] px-4"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-management-income-title"
        data-testid="cash-management-income-dialog"
        noValidate
        className="rounded-pipeline-card-sm bg-pipeline-surface flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-y-auto p-7 shadow-xl outline-none"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void income.submit();
        }}
      >
        <h2
          id="cash-management-income-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Book bank income
        </h2>
        <p className="text-pipeline-ink-muted text-sm">
          Books interest earned on the bank account on {income.chainLabel} and
          mints it into the vault. The bank reference can be used once.
        </p>
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="cash-management-income-amount"
        >
          Amount (USD)
          <input
            id="cash-management-income-amount"
            data-testid="cash-management-income-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="1250.50"
            value={income.amount}
            onChange={(event) => income.setAmount(event.target.value)}
            disabled={busy}
            className={INPUT_CLASS}
          />
        </label>
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="cash-management-income-date"
        >
          Value date
          <input
            id="cash-management-income-date"
            data-testid="cash-management-income-date"
            type="date"
            max={income.maxValueDate}
            value={income.valueDateInput}
            onChange={(event) => income.setValueDateInput(event.target.value)}
            disabled={busy}
            className={INPUT_CLASS}
          />
        </label>
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="cash-management-income-reference"
        >
          Bank reference
          <input
            id="cash-management-income-reference"
            data-testid="cash-management-income-reference"
            autoComplete="off"
            value={income.reference}
            onChange={(event) => income.setReference(event.target.value)}
            disabled={busy}
            className={INPUT_CLASS}
          />
        </label>
        {income.validationError && (
          <p
            role="alert"
            data-testid="cash-management-income-validation"
            className="text-pipeline-negative-strong text-sm"
          >
            {income.validationError}
          </p>
        )}
        {income.submitReason && (
          <p
            data-testid="cash-management-income-blocked"
            className="text-pipeline-ink-muted text-sm"
          >
            {income.submitReason}
          </p>
        )}
        {income.error && (
          <div data-testid="cash-management-income-error">
            <InlineError
              message={income.error.message}
              details={income.error.details}
            />
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            size="m"
            data-testid="cash-management-income-cancel"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary-blue"
            size="m"
            data-testid="cash-management-income-submit"
            disabled={busy || blocked}
          >
            {incomeStageLabel(income.stage)}
          </Button>
        </div>
      </form>
    </div>
  );
}

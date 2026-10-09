// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { Button, InlineError } from "@pipeline/ui";
import { CardTitle, DetailCard } from "@/components/detail/DetailCard";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  INK_MUTED,
  LINE_COLOR,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import {
  useLpBankDepositsSection,
  mintStageLabel,
  type DepositRow,
  type LpBankDepositsSection as Section,
} from "./-useLpBankDeposits";

const inputClass =
  "rounded-pipeline-card border-pipeline-line bg-pipeline-surface text-pipeline-ink focus:border-pipeline-brand w-full border p-3 focus:outline-none disabled:opacity-50";

const BODY_CLASS =
  "font-[family-name:var(--font-body)] text-[15px] leading-[21px]";

const HEAD_CELL_CLASS =
  "py-[12px] pr-[16px] font-normal font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]";

const BODY_CELL_CLASS =
  "py-[12px] pr-[16px] font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]";

export function LpBankDepositsSection({
  lpId,
  legalName,
}: {
  lpId: number;
  legalName: string;
}) {
  const section = useLpBankDepositsSection(lpId);
  return (
    <DetailCard
      className="gap-[16px] p-[26px]"
      ariaLabelledBy="lp-deposits-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <CardTitle id="lp-deposits-heading">Bank deposits</CardTitle>
        <Button
          variant="primary-blue"
          size="m"
          onClick={section.openDialog}
          disabled={section.busy}
        >
          Record deposit
        </Button>
      </div>
      {section.state === "loading" && (
        <p role="status" className={BODY_CLASS} style={{ color: INK_MUTED }}>
          Loading bank deposits…
        </p>
      )}
      {section.error && (
        <div role="alert" className="flex flex-col gap-[12px]">
          <InlineError
            message={section.error.message}
            details={section.error.details}
          />
          <Button
            variant="secondary"
            size="m"
            onClick={section.refresh}
            disabled={section.query.isFetching}
            className={`w-fit ${DETAIL_SECONDARY_BUTTON_CLASS}`}
            style={detailSecondaryButtonStyle()}
          >
            Retry
          </Button>
        </div>
      )}
      {section.state === "empty" && (
        <p className={BODY_CLASS} style={{ color: INK_MUTED }}>
          No bank deposits recorded.
        </p>
      )}
      {section.state === "ready" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead style={{ color: INK_MUTED }}>
              <tr>
                <th className={HEAD_CELL_CLASS}>Received</th>
                <th className={`${HEAD_CELL_CLASS} text-right`}>Amount</th>
                <th className={HEAD_CELL_CLASS}>Payment reference</th>
                <th className={HEAD_CELL_CLASS}>PLUSD</th>
                <th className={HEAD_CELL_CLASS}>Recorded by</th>
                <th className={`${HEAD_CELL_CLASS} pr-0`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, index) => (
                <tr
                  key={row.id}
                  style={
                    index === 0
                      ? undefined
                      : { borderTop: `1px solid ${LINE_COLOR}` }
                  }
                >
                  <td className={`${BODY_CELL_CLASS} whitespace-nowrap`}>
                    {row.occurredAt}
                  </td>
                  <td
                    className={`${BODY_CELL_CLASS} text-right whitespace-nowrap tabular-nums`}
                  >
                    {row.amount}
                  </td>
                  <td
                    className={`${BODY_CELL_CLASS} break-all`}
                    title={row.refHash}
                  >
                    {row.reference}
                  </td>
                  <td className={`${BODY_CELL_CLASS} whitespace-nowrap`}>
                    {row.minted}
                  </td>
                  <td className={`${BODY_CELL_CLASS} break-all`}>
                    {row.recordedBy}
                  </td>
                  <td className={`${BODY_CELL_CLASS} pr-0 whitespace-nowrap`}>
                    <MintCell row={row} section={section} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.mintError && (
        <div role="alert">
          <InlineError
            message={section.mintError.message}
            details={section.mintError.details}
          />
        </div>
      )}
      {section.open && (
        <RecordBankDepositDialog section={section} legalName={legalName} />
      )}
    </DetailCard>
  );
}

function MintCell({ row, section }: { row: DepositRow; section: Section }) {
  if (row.isMinted) return null;

  const inFlight = section.mintingDepositId === row.id;

  if (row.isPending && !inFlight) {
    return (
      <span className={BODY_CLASS} style={{ color: INK_MUTED }}>
        Waiting for the indexer
      </span>
    );
  }

  const reason = inFlight ? null : section.mintDisabledReason(row);
  const hintId = `lp-deposit-mint-hint-${row.id}`;

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        size="m"
        className={DETAIL_SECONDARY_BUTTON_CLASS}
        style={detailSecondaryButtonStyle()}
        onClick={() => void section.mintDeposit(row)}
        disabled={reason !== null || inFlight}
        title={reason ?? undefined}
        aria-describedby={reason ? hintId : undefined}
      >
        {inFlight ? mintStageLabel(section.mintStage) : "Mint PLUSD"}
      </Button>
      {reason && (
        <span
          id={hintId}
          className="font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px]"
          style={{ color: INK_MUTED }}
        >
          {reason}
        </span>
      )}
    </div>
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
            size="m"
            className={DETAIL_SECONDARY_BUTTON_CLASS}
            style={detailSecondaryButtonStyle()}
            disabled={section.busy}
            onClick={section.close}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary-blue"
            size="m"
            disabled={section.busy}
          >
            {section.busy ? "Recording…" : "Record deposit"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { Button, InlineError } from "@pipeline/ui";
import { AddressChip } from "@/components/detail/AddressChip";
import { AddressText } from "@/components/detail/AddressText";
import { CardTitle, DetailCard } from "@/components/detail/DetailCard";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import { StatusChip } from "@/components/detail/StatusChip";
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
  noReceiverMessage,
  type DepositRow,
  type LpBankDepositsSection as Section,
} from "./-useLpBankDeposits";

const inputClass =
  "rounded-pipeline-card border-pipeline-line bg-pipeline-surface text-pipeline-ink focus:border-pipeline-brand w-full border p-3 focus:outline-none disabled:opacity-50";

const BODY_CLASS =
  "font-[family-name:var(--font-body)] text-[15px] leading-[21px]";

const HEAD_CELL_CLASS =
  "py-[12px] pr-[16px] font-normal font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]";

const HINT_CLASS =
  "font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px]";

const COLUMN_WIDTHS = ["22%", "16%", "26%", "18%", "18%"] as const;

const MINT_BUTTON_CLASS =
  "!rounded-[4px] text-[13px] whitespace-nowrap disabled:opacity-[0.32]";

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
      <MintScopeLine section={section} />
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
          <table className="w-full min-w-[820px] table-fixed text-left">
            <colgroup>
              {COLUMN_WIDTHS.map((width) => (
                <col key={width} style={{ width }} />
              ))}
            </colgroup>
            <thead style={{ color: INK_MUTED }}>
              <tr>
                <th className={HEAD_CELL_CLASS}>Received</th>
                <th className={`${HEAD_CELL_CLASS} text-right`}>Amount</th>
                <th className={HEAD_CELL_CLASS}>Payment reference</th>
                <th className={HEAD_CELL_CLASS}>Recorded by</th>
                <th className={`${HEAD_CELL_CLASS} pr-0`}>PLUSD</th>
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
                  <td className={BODY_CELL_CLASS}>
                    {row.recordedBy ? (
                      <AddressText value={row.recordedBy} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`${BODY_CELL_CLASS} pr-0`}>
                    <PlusdCell row={row} section={section} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.open && (
        <RecordBankDepositDialog section={section} legalName={legalName} />
      )}
      {section.confirm && (
        <MintConfirmDialog section={section} legalName={legalName} />
      )}
    </DetailCard>
  );
}

function MintScopeLine({ section }: { section: Section }) {
  const { receiver, chainLabel, kind } = section;
  return (
    <p
      data-testid="lp-deposits-mint-scope"
      className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
      style={{ color: INK_MUTED }}
    >
      {receiver ? (
        <>
          Mints on {chainLabel} to{" "}
          <AddressChip
            value={receiver.receiver}
            testId="lp-deposits-receiver"
          />
          {receiver.isCapitalWallet &&
            ` · capital wallet — this LP has no ${kind === "stellar" ? "Stellar" : "EVM"} settlement address`}
        </>
      ) : (
        `Mints on ${chainLabel} — no receiver`
      )}
    </p>
  );
}

function PlusdCell({ row, section }: { row: DepositRow; section: Section }) {
  if (row.isMinted) {
    return (
      <StatusChip band="positive" label="Minted" testId="lp-deposit-minted" />
    );
  }

  const inFlight = section.mintingDepositId === row.id;

  if (row.isPending && !inFlight) {
    return (
      <div className="flex flex-col items-start gap-[4px]">
        <StatusChip
          band="attention"
          label="Pending"
          testId="lp-deposit-pending"
        />
        <span className={HINT_CLASS} style={{ color: INK_MUTED }}>
          Waiting for the indexer
        </span>
      </div>
    );
  }

  const reason = inFlight ? null : section.mintDisabledReason(row);
  const hintId = `lp-deposit-mint-hint-${row.id}`;

  return (
    <div className="flex flex-col items-start gap-[4px]">
      <Button
        variant="primary-blue"
        size="compact"
        className={MINT_BUTTON_CLASS}
        onClick={() => void section.openMint(row)}
        disabled={reason !== null || inFlight}
        title={reason ?? undefined}
        aria-describedby={reason ? hintId : undefined}
      >
        {inFlight ? mintStageLabel(section.mintStage) : "Mint PLUSD"}
      </Button>
      {reason && (
        <span id={hintId} className={HINT_CLASS} style={{ color: INK_MUTED }}>
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

function MintConfirmDialog({
  section,
  legalName,
}: {
  section: Section;
  legalName: string;
}) {
  const confirm = section.confirm!;
  const minting = section.mintingDepositId !== null;
  const dialogRef = useLpReviewDialog<HTMLDivElement>(
    section.closeMint,
    minting,
  );
  const ready = confirm.phase === "ready" ? confirm : null;
  const canConfirm =
    ready !== null && (!ready.changed || section.ack) && !minting;
  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={() => {
        if (!minting) section.closeMint();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lp-mint-title"
        aria-describedby="lp-mint-description"
        tabIndex={-1}
        data-testid="lp-mint-confirm"
        className="rounded-pipeline-card-sm bg-pipeline-surface flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-y-auto p-7 shadow-xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="lp-mint-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Mint PLUSD — {legalName}
        </h2>
        <p id="lp-mint-description" className="text-pipeline-ink-muted text-sm">
          Check the receiver. PLUSD is minted to the LP&apos;s current
          settlement address, re-read now.
        </p>
        {confirm.phase === "reading" && (
          <p role="status" className={BODY_CLASS} style={{ color: INK_MUTED }}>
            Reading the LP&apos;s current settlement address…
          </p>
        )}
        {confirm.phase === "read-error" && (
          <div role="alert" className="flex flex-col gap-[12px]">
            <InlineError
              message={confirm.error.message}
              details={confirm.error.details}
            />
            <Button
              type="button"
              variant="secondary"
              size="m"
              className={`w-fit ${DETAIL_SECONDARY_BUTTON_CLASS}`}
              style={detailSecondaryButtonStyle()}
              onClick={() => void section.openMint(confirm.row)}
            >
              Retry
            </Button>
          </div>
        )}
        {confirm.phase === "no-receiver" && (
          <p role="alert" className={BODY_CLASS} style={{ color: INK_MUTED }}>
            {noReceiverMessage(section.kind)}
          </p>
        )}
        {ready && (
          <div className="flex flex-col">
            <KeyValueRow label="Network">{section.chainLabel}</KeyValueRow>
            <KeyValueRow label="Amount">{ready.row.amount}</KeyValueRow>
            <KeyValueRow label="Payment reference">
              <span className="break-all">{ready.row.reference}</span>
            </KeyValueRow>
            <KeyValueRow label="Receiver" isLast>
              <span
                data-testid="lp-mint-receiver"
                className="font-mono text-[13px] leading-[18px] break-all"
              >
                {ready.receiver.receiver}
              </span>
              <span
                className={`${HINT_CLASS} block`}
                style={{ color: INK_MUTED }}
              >
                {ready.receiver.isCapitalWallet
                  ? "Capital wallet"
                  : "LP settlement address"}
              </span>
            </KeyValueRow>
          </div>
        )}
        {ready?.changed && (
          <div
            role="alert"
            data-testid="lp-mint-receiver-changed"
            className="rounded-pipeline-card-sm flex flex-col gap-2 border p-4 text-sm"
            style={{ borderColor: "var(--color-pipeline-warning)" }}
          >
            <p className="font-semibold">
              This LP&apos;s settlement address changed since it was last shown.
            </p>
            <p className="break-all">
              Previously shown: {ready.previous?.receiver ?? "—"}
            </p>
            <p className="break-all">
              Now minting to: {ready.receiver.receiver}
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid="lp-mint-ack"
                checked={section.ack}
                onChange={(event) => section.setAck(event.target.checked)}
                disabled={minting}
              />
              Mint to the new address
            </label>
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
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            size="m"
            className={DETAIL_SECONDARY_BUTTON_CLASS}
            style={detailSecondaryButtonStyle()}
            disabled={minting}
            onClick={section.closeMint}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary-blue"
            size="m"
            data-testid="lp-mint-confirm-submit"
            disabled={!canConfirm}
            onClick={() => void section.confirmMint()}
          >
            {mintStageLabel(section.mintStage)}
          </Button>
        </div>
      </div>
    </div>
  );
}

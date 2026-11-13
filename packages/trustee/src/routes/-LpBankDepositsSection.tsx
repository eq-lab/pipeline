// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { Link } from "@tanstack/react-router";
import { Button, InlineError } from "@pipeline/ui";
import { AddressChip } from "@/components/detail/AddressChip";
import { AddressText } from "@/components/detail/AddressText";
import { CardTitle, DetailCard } from "@/components/detail/DetailCard";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import { StatusChip } from "@/components/detail/StatusChip";
import {
  DETAIL_INPUT_CLASS,
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
  plusdBlockMessage,
  type DepositRow,
  type LpBankDepositsSection as Section,
} from "./-useLpBankDeposits";

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

const ESCROW_LINK_CLASS =
  "text-[color:var(--color-pipeline-brand)] underline underline-offset-2";

export function LpBankDepositsSection({
  lpId,
  legalName,
  initialPaymentDetails,
  onPrefillConsumed,
}: {
  lpId: number;
  legalName: string;
  initialPaymentDetails?: string;
  onPrefillConsumed?: () => void;
}) {
  const section = useLpBankDepositsSection(
    lpId,
    initialPaymentDetails,
    onPrefillConsumed,
  );
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
          onClick={() => section.openDialog()}
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
                <th className={HEAD_CELL_CLASS}>Bank reference</th>
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
                    <AttributionCell row={row} />
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

function AttributionCell({ row }: { row: DepositRow }) {
  if (!row.matched) {
    return (
      <div className="mt-[4px]">
        <StatusChip
          band="neutral"
          label="Attributed by hand"
          testId="lp-deposit-hand"
        />
      </div>
    );
  }
  return (
    <div className="mt-[4px] flex flex-col items-start gap-[4px]">
      <StatusChip
        band="info"
        label="Matched by reference"
        testId="lp-deposit-matched"
      />
      <span
        data-testid="lp-deposit-matched-ref"
        className={HINT_CLASS}
        style={{ color: INK_MUTED }}
      >
        {row.matched.paymentDetails} · issued {row.matched.issuedAt}
      </span>
    </div>
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
          Record a wire received from this LP. The bank reference must be unique
          — it identifies the wire when PLUSD is minted. Add the LP payment
          reference the LP quoted to match the wire by reference.
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
            className={DETAIL_INPUT_CLASS}
          />
        </label>
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="lp-deposit-reference"
        >
          Bank reference
          <input
            id="lp-deposit-reference"
            autoComplete="off"
            value={section.reference}
            onChange={(event) => section.setReference(event.target.value)}
            disabled={section.busy}
            className={DETAIL_INPUT_CLASS}
          />
          <span className={HINT_CLASS} style={{ color: INK_MUTED }}>
            The bank&apos;s own reference for this wire (statement line, MT103
            field 20 or UETR). Must be unique.
          </span>
        </label>
        <label
          className="flex flex-col gap-2 text-sm"
          htmlFor="lp-deposit-payment-details"
        >
          LP payment reference
          <input
            id="lp-deposit-payment-details"
            autoComplete="off"
            placeholder="PL-XXXX-XXXX-XXXX"
            value={section.paymentDetails}
            onChange={(event) => section.setPaymentDetails(event.target.value)}
            disabled={section.busy}
            className={DETAIL_INPUT_CLASS}
          />
          <span className={HINT_CLASS} style={{ color: INK_MUTED }}>
            The PL-XXXX-XXXX-XXXX reference the LP quoted. Leave blank to
            attribute the wire by hand.
          </span>
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
            className={DETAIL_INPUT_CLASS}
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
        {section.mutationEscrowHint && (
          <p className="text-pipeline-ink-muted text-sm">
            Wires that cannot be matched to an LP are booked to escrow by the
            Cash reporter.{" "}
            <Link
              to="/cash-management"
              search={{ tab: "escrow" }}
              data-testid="lp-deposit-escrow-link"
              className={ESCROW_LINK_CLASS}
            >
              Escrowed wires
            </Link>
          </p>
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
        {(confirm.phase === "no-trustline" ||
          confirm.phase === "not-authorized") && (
          <p
            role="alert"
            data-testid={
              confirm.phase === "no-trustline"
                ? "lp-mint-no-trustline"
                : "lp-mint-not-authorized"
            }
            className={BODY_CLASS}
            style={{ color: INK_MUTED }}
          >
            {plusdBlockMessage(confirm.phase, confirm.receiver.isCapitalWallet)}
          </p>
        )}
        {ready && (
          <div className="flex flex-col">
            <KeyValueRow label="Network">{section.chainLabel}</KeyValueRow>
            <KeyValueRow label="Amount">{ready.row.amount}</KeyValueRow>
            <KeyValueRow label="Bank reference">
              <span className="break-all">{ready.row.reference}</span>
            </KeyValueRow>
            {ready.row.matched && (
              <>
                <KeyValueRow label="LP payment reference">
                  <span className="break-all">
                    {ready.row.matched.paymentDetails}
                  </span>
                </KeyValueRow>
                <KeyValueRow label="Shown to the LP">
                  <span
                    data-testid="lp-mint-shown-receiver"
                    className="font-mono text-[13px] leading-[18px] break-all"
                  >
                    {ready.row.matched.chainLabel} ·{" "}
                    {ready.row.matched.receiverAddress ?? "—"}
                  </span>
                </KeyValueRow>
              </>
            )}
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
        {ready?.row.matched?.receiverAddress &&
          ready.row.matched.receiverAddress !== ready.receiver.receiver && (
            <p
              data-testid="lp-mint-shown-differs"
              className={HINT_CLASS}
              style={{ color: INK_MUTED }}
            >
              The LP&apos;s settlement address changed since this reference was
              issued. PLUSD goes to the current address.
            </p>
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

// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { RampDirection } from "@pipeline/wallet-connect";
import { Button, InlineError } from "@pipeline/ui";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import { StatusChip } from "@/components/detail/StatusChip";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  INK_MUTED,
  LINE_COLOR,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import {
  CLOSE_SHORTFALL_COPY,
  RAMP_DIRECTION_EFFECT,
  RAMP_DIRECTION_LABEL,
} from "@/lib/conversions";
import { rawToDecimal7, todayUtcDateInput } from "@/lib/wireOut";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import { escrowStageLabel } from "./-escrowed-wires";
import {
  ACTION_BUTTON_CLASS,
  BODY_CELL_CLASS,
  BODY_CLASS,
  DIALOG_CLASS,
  HEAD_CELL_CLASS,
  HINT_CLASS,
  INPUT_CLASS,
  shortHash,
} from "./-WireOutsSection";
import {
  closeValidation,
  conversionResultMessage,
  expenseValidation,
  openValidation,
  useConversionsSection,
  type CloseDialogState,
  type ConversionRow,
  type ConversionsSection as Section,
  type ExpenseDialogState,
  type OpenDialogState,
} from "./-conversions";

const DIRECTIONS: RampDirection[] = ["UsdcToBank", "BankToUsdc"];

function statusBand(status: ConversionRow["status"]) {
  return status === "Closed" ? ("neutral" as const) : ("attention" as const);
}

function chainBand(state: ConversionRow["chainState"]) {
  if (state === "confirmed") return "positive" as const;
  if (state === "mismatch" || state === "read-error")
    return "negative" as const;
  return "attention" as const;
}

function Card({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="flex w-full flex-col gap-[16px] rounded-[4px] bg-white px-[27px] py-[25px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      {children}
    </div>
  );
}

function Skeleton({ testId }: { testId: string }) {
  return (
    <div data-testid={testId} role="status" className="flex flex-col gap-[8px]">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-[36px] animate-pulse rounded-[4px]"
          style={{ backgroundColor: "rgba(191,189,187,0.2)" }}
        />
      ))}
    </div>
  );
}

export function ConversionsSection() {
  const section = useConversionsSection();
  return (
    <div className="flex w-full flex-col gap-[16px]">
      <PoolSummary section={section} />
      <ConversionsCard section={section} />
      {section.openDialog && (
        <OpenConversionDialog section={section} state={section.openDialog} />
      )}
      {section.closeDialog && (
        <CloseConversionDialog section={section} state={section.closeDialog} />
      )}
      {section.expenseDialog && (
        <RecordExpenseDialog section={section} state={section.expenseDialog} />
      )}
    </div>
  );
}

function PoolSummary({ section }: { section: Section }) {
  const { summary } = section;
  const tiles = [
    ["pool-summary-bank-cash", "Booked bank cash", summary.bankCash],
    ["pool-summary-in-flight", "Cash in transit", summary.inFlight],
    ["pool-summary-total", "Pool total", summary.totalAssets],
  ] as const;
  return (
    <Card testId="cash-management-pool-summary">
      <span className="font-[family-name:var(--font-display)] text-[20px] leading-[28px] text-[#262524]">
        Pool summary
      </span>
      {summary.state === "unsupported" && (
        <p
          data-testid="pool-summary-unsupported"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          {section.unsupportedReason}
        </p>
      )}
      {summary.state === "loading" && (
        <Skeleton testId="pool-summary-loading" />
      )}
      {summary.state === "error" && summary.error && (
        <div
          role="alert"
          data-testid="pool-summary-error"
          className="flex flex-col gap-[12px]"
        >
          <InlineError
            message={summary.error.message}
            details={summary.error.details}
          />
          <Button
            variant="secondary"
            size="m"
            onClick={summary.retry}
            className={`w-fit ${DETAIL_SECONDARY_BUTTON_CLASS}`}
            style={detailSecondaryButtonStyle()}
          >
            Retry
          </Button>
        </div>
      )}
      {summary.state === "ready" && (
        <>
          <div className="flex flex-wrap gap-[32px]">
            {tiles.map(([testId, label, value]) => (
              <div key={testId} className="flex flex-col gap-[2px]">
                <span className={HINT_CLASS} style={{ color: INK_MUTED }}>
                  {label}
                </span>
                <span
                  data-testid={testId}
                  className="font-[family-name:var(--font-display)] text-[24px] leading-[32px] text-[#262524] tabular-nums"
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
          <p
            data-testid="pool-summary-source"
            className={HINT_CLASS}
            style={{ color: INK_MUTED }}
          >
            Read on-chain from the minter {summary.sourceMinter} (pool_state).
          </p>
          {summary.readFailed && (
            <p
              data-testid="pool-summary-read-failed"
              className={HINT_CLASS}
              style={{ color: INK_MUTED }}
            >
              A custody balance could not be read; the minter counts it as 0 in
              the pool total.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function ActionButton({
  testId,
  label,
  reason,
  primary,
  onClick,
}: {
  testId: string;
  label: string;
  reason: string | null;
  primary: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex max-w-[320px] flex-col items-start gap-[6px]">
      <Button
        variant={primary ? "primary-blue" : "secondary"}
        size="m"
        className={primary ? undefined : DETAIL_SECONDARY_BUTTON_CLASS}
        style={primary ? undefined : detailSecondaryButtonStyle()}
        data-testid={testId}
        disabled={reason !== null}
        title={reason ?? undefined}
        onClick={onClick}
      >
        {label}
      </Button>
      {reason && (
        <span
          data-testid={`${testId}-reason`}
          className={HINT_CLASS}
          style={{ color: INK_MUTED }}
        >
          {reason}
        </span>
      )}
    </div>
  );
}

function ConversionsCard({ section }: { section: Section }) {
  return (
    <Card testId="cash-management-conversions">
      <div className="flex flex-col gap-[2px]">
        <span className="flex items-center gap-[10px]">
          <span className="font-[family-name:var(--font-display)] text-[20px] leading-[28px] text-[#262524]">
            Conversions
          </span>
          <span
            data-testid="cash-management-conversions-chain"
            className="rounded-[4px] px-[8px] py-[2px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ border: `1px solid ${LINE_COLOR}`, color: INK_MUTED }}
          >
            {section.chainLabel}
          </span>
        </span>
        <span
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          USDC and bank-dollar conversions, and bank charges, booked on the
          minter. Custody accounts sign their own USDC moves; the console only
          books them.
        </span>
      </div>

      {section.lastResult && (
        <div
          role="status"
          data-testid="conversion-result"
          className="flex flex-wrap items-start justify-between gap-[12px] rounded-[4px] px-[15px] py-[13px] font-[family-name:var(--font-body)] text-[14px] break-all"
          style={{
            backgroundColor: "rgba(32,128,0,0.08)",
            color: "var(--color-pipeline-positive-primary)",
          }}
        >
          <span>
            {conversionResultMessage(section.lastResult)}
            {section.lastResult.kind === "expense" && (
              <>
                {" "}
                <Link
                  to="/audit-log"
                  data-testid="conversion-result-audit-link"
                  className="underline"
                >
                  View Audit Log
                </Link>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={section.dismissResult}
            className="underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {section.minterMismatch && (
        <p
          role="alert"
          data-testid="conversion-minter-mismatch"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          The app&apos;s minter differs from the server&apos;s cash-book minter.
          Actions are disabled.
        </p>
      )}

      {section.state !== "unsupported" && (
        <div className="flex flex-wrap items-start gap-[16px]">
          <ActionButton
            testId="conversion-open"
            label="Open conversion"
            reason={section.actionReason("open_ramp")}
            primary
            onClick={section.openOpen}
          />
          <ActionButton
            testId="expense-open"
            label="Record bank charge"
            reason={section.actionReason("record_expense")}
            primary={false}
            onClick={section.openExpense}
          />
        </div>
      )}

      {section.state === "unsupported" && (
        <p
          data-testid="conversion-unsupported"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          {section.unsupportedReason}
        </p>
      )}
      {section.state === "loading" && <Skeleton testId="conversion-loading" />}
      {section.state === "error" && section.error && (
        <div
          role="alert"
          data-testid="conversion-error"
          className="flex flex-col gap-[12px]"
        >
          <InlineError
            message={section.error.message}
            details={section.error.details}
          />
          <Button
            variant="secondary"
            size="m"
            onClick={section.refresh}
            className={`w-fit ${DETAIL_SECONDARY_BUTTON_CLASS}`}
            style={detailSecondaryButtonStyle()}
          >
            Retry
          </Button>
        </div>
      )}
      {section.state === "empty" && (
        <p
          data-testid="conversion-empty"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          {section.emptyMessage}
        </p>
      )}
      {section.state === "ready" && (
        <div className="overflow-x-auto">
          <table
            data-testid="ramp-table"
            className="w-full min-w-[1280px] table-fixed text-left"
          >
            <colgroup>
              {[
                "5%",
                "9%",
                "10%",
                "11%",
                "11%",
                "8%",
                "9%",
                "9%",
                "11%",
                "10%",
                "7%",
              ].map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead style={{ color: INK_MUTED }}>
              <tr>
                <th className={HEAD_CELL_CLASS}>ID</th>
                <th className={HEAD_CELL_CLASS}>Direction</th>
                <th className={`${HEAD_CELL_CLASS} text-right`}>Amount</th>
                <th className={HEAD_CELL_CLASS}>Opened at</th>
                <th className={HEAD_CELL_CLASS}>Reference hash</th>
                <th className={HEAD_CELL_CLASS}>Status</th>
                <th className={`${HEAD_CELL_CLASS} text-right`}>Received</th>
                <th className={`${HEAD_CELL_CLASS} text-right`}>Shortfall</th>
                <th className={HEAD_CELL_CLASS}>Closed at</th>
                <th className={HEAD_CELL_CLASS}>On-chain</th>
                <th className={`${HEAD_CELL_CLASS} pr-0`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, index) => (
                <RampTableRow
                  key={row.id}
                  row={row}
                  index={index}
                  section={section}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function HashCell({ hash, testId }: { hash: string | null; testId: string }) {
  if (!hash) return <span style={{ color: INK_MUTED }}>—</span>;
  return (
    <span data-testid={testId} className="font-mono text-[13px]" title={hash}>
      {shortHash(hash)}
    </span>
  );
}

function RampTableRow({
  row,
  index,
  section,
}: {
  row: ConversionRow;
  index: number;
  section: Section;
}) {
  const open = row.status === "Open";
  const reason = open ? section.actionReason("close_ramp", row) : null;
  const testId = `ramp-row-${row.id}`;
  return (
    <tr
      data-testid={testId}
      style={index === 0 ? undefined : { borderTop: `1px solid ${LINE_COLOR}` }}
    >
      <td className={`${BODY_CELL_CLASS} tabular-nums`}>#{row.id}</td>
      <td className={BODY_CELL_CLASS}>{row.directionLabel}</td>
      <td
        className={`${BODY_CELL_CLASS} text-right whitespace-nowrap tabular-nums`}
      >
        {row.amount}
      </td>
      <td className={BODY_CELL_CLASS}>{row.openedAt}</td>
      <td className={BODY_CELL_CLASS}>
        <div className="flex flex-col">
          <HashCell hash={row.openRefHash} testId={`${testId}-open-hash`} />
          {row.closeRefHash && (
            <HashCell hash={row.closeRefHash} testId={`${testId}-close-hash`} />
          )}
        </div>
      </td>
      <td className={BODY_CELL_CLASS}>
        <StatusChip
          band={statusBand(row.status)}
          label={row.status}
          testId={`${testId}-status`}
        />
      </td>
      <td
        data-testid={`${testId}-received`}
        className={`${BODY_CELL_CLASS} text-right whitespace-nowrap tabular-nums`}
      >
        {row.received}
      </td>
      <td
        data-testid={`${testId}-shortfall`}
        className={`${BODY_CELL_CLASS} text-right whitespace-nowrap tabular-nums`}
      >
        {row.shortfall}
      </td>
      <td className={BODY_CELL_CLASS}>{row.closedAt}</td>
      <td className={BODY_CELL_CLASS}>
        {row.chainState === null ? (
          <span style={{ color: INK_MUTED }}>{row.chainLabel}</span>
        ) : (
          <StatusChip
            band={chainBand(row.chainState)}
            label={row.chainLabel}
            testId={`${testId}-chain`}
          />
        )}
      </td>
      <td className={`${BODY_CELL_CLASS} pr-0`}>
        {open && (
          <div className="flex flex-col items-start gap-[6px]">
            <Button
              variant="primary-blue"
              size="compact"
              className={ACTION_BUTTON_CLASS}
              data-testid={`${testId}-close`}
              disabled={reason !== null}
              title={reason ?? undefined}
              onClick={() => void section.openClose(row)}
            >
              Close
            </Button>
            {reason && (
              <span
                data-testid={`${testId}-reason`}
                className={HINT_CLASS}
                style={{ color: INK_MUTED }}
              >
                {reason}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function DialogShell({
  id,
  title,
  submitting,
  onClose,
  children,
}: {
  id: string;
  title: string;
  submitting: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useLpReviewDialog<HTMLDivElement>(onClose, submitting);
  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid={`${id}-backdrop`}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        data-testid={`${id}-dialog`}
        className={DIALOG_CLASS}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id={`${id}-title`}
          className="font-display text-[26px] leading-[36px]"
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function HashRow({ id, hash }: { id: string; hash: string | null }) {
  return (
    <KeyValueRow label="Reference hash" isLast>
      <span
        data-testid={`${id}-hash`}
        className="font-mono text-[13px] leading-[18px] break-all"
      >
        {hash ?? "—"}
      </span>
    </KeyValueRow>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      {children}
    </label>
  );
}

function Validation({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" data-testid={`${id}-validation`} className={HINT_CLASS}>
      {message}
    </p>
  );
}

function DialogError({
  id,
  error,
}: {
  id: string;
  error: { message: string; details: string } | null;
}) {
  if (!error) return null;
  return (
    <div role="alert" data-testid={`${id}-error`}>
      <InlineError message={error.message} details={error.details} />
    </div>
  );
}

function DialogActions({
  id,
  submitting,
  disabled,
  cancelLabel = "Cancel",
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  id: string;
  submitting: boolean;
  disabled: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-3">
      <Button
        type="button"
        variant="secondary"
        size="m"
        className={DETAIL_SECONDARY_BUTTON_CLASS}
        style={detailSecondaryButtonStyle()}
        disabled={submitting}
        onClick={onCancel}
      >
        {cancelLabel}
      </Button>
      <Button
        type="button"
        variant="primary-blue"
        size="m"
        data-testid={`${id}-confirm`}
        disabled={disabled || submitting}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

function OpenConversionDialog({
  section,
  state,
}: {
  section: Section;
  state: OpenDialogState;
}) {
  const invalid = openValidation(state);
  return (
    <DialogShell
      id="conversion-open"
      title="Open conversion"
      submitting={state.submitting}
      onClose={section.closeOpen}
    >
      <p className="text-pipeline-ink-muted text-sm">
        Books a conversion between USDC and bank dollars as cash in transit
        until it is closed. The transfer reference can be used once.
      </p>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">Direction</legend>
        {DIRECTIONS.map((direction) => (
          <label key={direction} className="flex items-start gap-2">
            <input
              type="radio"
              name="conversion-direction"
              data-testid={`conversion-direction-${direction}`}
              checked={state.direction === direction}
              disabled={state.submitting}
              onChange={() => section.setOpenDirection(direction)}
            />
            <span className="flex flex-col">
              <span>{RAMP_DIRECTION_LABEL[direction]}</span>
              <span className={HINT_CLASS} style={{ color: INK_MUTED }}>
                {RAMP_DIRECTION_EFFECT[direction]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Amount (USD)">
        <input
          type="text"
          inputMode="decimal"
          data-testid="conversion-open-amount"
          className={INPUT_CLASS}
          value={state.amountInput}
          disabled={state.submitting}
          onChange={(event) => section.setOpenAmount(event.target.value)}
        />
      </Field>
      <Field label="Transfer reference">
        <input
          type="text"
          data-testid="conversion-open-reference"
          className={INPUT_CLASS}
          value={state.reference}
          disabled={state.submitting}
          onChange={(event) => section.setOpenReference(event.target.value)}
        />
      </Field>
      <Validation id="conversion-open" message={invalid} />
      <HashRow id="conversion-open" hash={state.refHash} />
      <DialogError id="conversion-open" error={state.error} />
      <DialogActions
        id="conversion-open"
        submitting={state.submitting}
        disabled={invalid !== null}
        confirmLabel={
          state.submitting
            ? escrowStageLabel(section.openStage, "Checking…")
            : "Open conversion"
        }
        onCancel={section.closeOpen}
        onConfirm={() => void section.confirmOpen()}
      />
    </DialogShell>
  );
}

const PHASE_COPY: Partial<Record<CloseDialogState["phase"], string>> = {
  reading: "Confirming this conversion on-chain…",
  closed: "This conversion is already closed on-chain. Refresh the list.",
};

function CloseConversionDialog({
  section,
  state,
}: {
  section: Section;
  state: CloseDialogState;
}) {
  const invalid = closeValidation(state);
  const phaseCopy = PHASE_COPY[state.phase];
  const { row, ramp } = state;
  return (
    <DialogShell
      id="conversion-close"
      title={`Close conversion #${row.id}`}
      submitting={state.submitting}
      onClose={section.closeClose}
    >
      <p className="text-pipeline-ink-muted text-sm">{CLOSE_SHORTFALL_COPY}</p>
      <div className="flex flex-col">
        <KeyValueRow label="Conversion">#{row.id}</KeyValueRow>
        <KeyValueRow label="Direction">{row.directionLabel}</KeyValueRow>
        <KeyValueRow label="Opened amount (cash book)">
          {row.amount}
        </KeyValueRow>
        <KeyValueRow label="Opened amount (on-chain)" isLast>
          <span data-testid="conversion-close-onchain-amount">
            {ramp ? rawToDecimal7(ramp.amount) : "—"}
          </span>
        </KeyValueRow>
      </div>
      {phaseCopy && (
        <p
          role="status"
          data-testid="conversion-close-phase"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          {phaseCopy}
        </p>
      )}
      <Field label="Amount received (USD)">
        <input
          type="text"
          inputMode="decimal"
          data-testid="conversion-close-received"
          className={INPUT_CLASS}
          value={state.receivedInput}
          disabled={state.submitting || state.phase !== "open"}
          onChange={(event) => section.setReceivedInput(event.target.value)}
        />
      </Field>
      <Field label="Closing reference">
        <input
          type="text"
          data-testid="conversion-close-reference"
          className={INPUT_CLASS}
          value={state.reference}
          disabled={state.submitting || state.phase !== "open"}
          onChange={(event) => section.setCloseReference(event.target.value)}
        />
      </Field>
      {state.phase === "open" && (
        <Validation id="conversion-close" message={invalid} />
      )}
      <HashRow id="conversion-close" hash={state.refHash} />
      <DialogError id="conversion-close" error={state.error} />
      <DialogActions
        id="conversion-close"
        submitting={state.submitting}
        disabled={state.phase !== "open" || invalid !== null}
        cancelLabel="Keep open"
        confirmLabel={
          state.submitting
            ? escrowStageLabel(section.closeStage, "Checking…")
            : "Close conversion"
        }
        onCancel={section.closeClose}
        onConfirm={() => void section.confirmClose()}
      />
    </DialogShell>
  );
}

function RecordExpenseDialog({
  section,
  state,
}: {
  section: Section;
  state: ExpenseDialogState;
}) {
  const invalid = expenseValidation(state);
  return (
    <DialogShell
      id="expense"
      title="Record bank charge"
      submitting={state.submitting}
      onClose={section.closeExpense}
    >
      <p className="text-pipeline-ink-muted text-sm">
        Takes the charge out of booked bank cash and burns it from the vault.
        The bank reference can be used once.
      </p>
      <Field label="Charge amount (USD)">
        <input
          type="text"
          inputMode="decimal"
          data-testid="expense-amount"
          className={INPUT_CLASS}
          value={state.amountInput}
          disabled={state.submitting}
          onChange={(event) => section.setExpenseAmount(event.target.value)}
        />
      </Field>
      <Field label="Value date">
        <input
          type="date"
          data-testid="expense-date"
          className={INPUT_CLASS}
          max={todayUtcDateInput()}
          value={state.valueDateInput}
          disabled={state.submitting}
          onChange={(event) => section.setExpenseDate(event.target.value)}
        />
      </Field>
      <Field label="Bank reference">
        <input
          type="text"
          data-testid="expense-reference"
          className={INPUT_CLASS}
          value={state.reference}
          disabled={state.submitting}
          onChange={(event) => section.setExpenseReference(event.target.value)}
        />
      </Field>
      <Validation id="expense" message={invalid} />
      <HashRow id="expense" hash={state.refHash} />
      <DialogError id="expense" error={state.error} />
      <DialogActions
        id="expense"
        submitting={state.submitting}
        disabled={invalid !== null}
        confirmLabel={
          state.submitting
            ? escrowStageLabel(section.expenseStage, "Checking…")
            : "Record bank charge"
        }
        onCancel={section.closeExpense}
        onConfirm={() => void section.confirmExpense()}
      />
    </DialogShell>
  );
}

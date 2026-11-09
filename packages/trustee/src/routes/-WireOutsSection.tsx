// spec: docs/frontend/trustee-flows.md#cash-management--bank-wire-outs
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button, InlineError } from "@pipeline/ui";
import { AddressChip } from "@/components/detail/AddressChip";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import { StatusChip } from "@/components/detail/StatusChip";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  INK_MUTED,
  LINE_COLOR,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import { LP_NOT_AUTHORIZED_COPY, todayUtcDateInput } from "@/lib/wireOut";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import { escrowStageLabel } from "./-escrowed-wires";
import {
  settleValidation,
  useWireOutsSection,
  wireOutResultMessage,
  type CancelDialogState,
  type SettleDialogState,
  type WireOutRow,
  type WireOutsSection as Section,
} from "./-wire-outs";

const BODY_CLASS =
  "font-[family-name:var(--font-body)] text-[15px] leading-[21px]";
const HINT_CLASS =
  "font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px]";
const HEAD_CELL_CLASS =
  "py-[12px] pr-[16px] font-normal font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]";
const BODY_CELL_CLASS =
  "py-[12px] pr-[16px] align-top font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[#262524]";
const ACTION_BUTTON_CLASS =
  "!rounded-[4px] text-[13px] whitespace-nowrap disabled:opacity-[0.32]";
const DIALOG_CLASS =
  "rounded-pipeline-card-sm bg-pipeline-surface flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-y-auto p-7 shadow-xl outline-none";
const INPUT_CLASS =
  "rounded-pipeline-card border-pipeline-line bg-pipeline-surface text-pipeline-ink focus:border-pipeline-brand w-full border p-3 focus:outline-none disabled:opacity-50";
const NO_BANK_ACCOUNT_HINT =
  "The API does not serve the lender's bank account yet.";

function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

function statusBand(status: WireOutRow["status"]) {
  if (status === "Settled") return "positive" as const;
  if (status === "Cancelled") return "neutral" as const;
  return "attention" as const;
}

function chainBand(state: WireOutRow["chainState"]) {
  if (state === "confirmed") return "positive" as const;
  if (state === "mismatch" || state === "read-error")
    return "negative" as const;
  return "attention" as const;
}

export function WireOutsSection() {
  const section = useWireOutsSection();
  return (
    <div
      data-testid="cash-management-wireouts"
      className="flex w-full flex-col gap-[16px] rounded-[4px] bg-white px-[27px] py-[25px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      <div className="flex flex-col gap-[2px]">
        <span className="flex items-center gap-[10px]">
          <span className="font-[family-name:var(--font-display)] text-[20px] leading-[28px] text-[#262524]">
            Bank wire-outs
          </span>
          <span
            data-testid="cash-management-wireouts-chain"
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
          Lender bank withdrawals held in escrow by the minter on{" "}
          {section.chainLabel} — settle once the wire is sent, or cancel to
          return the PLUSD.
        </span>
      </div>

      {section.lastResult && (
        <div
          role="status"
          data-testid="wireout-result"
          className="flex flex-wrap items-start justify-between gap-[12px] rounded-[4px] px-[15px] py-[13px] font-[family-name:var(--font-body)] text-[14px] break-all"
          style={{
            backgroundColor: "rgba(32,128,0,0.08)",
            color: "var(--color-pipeline-positive-primary)",
          }}
        >
          <span>{wireOutResultMessage(section.lastResult)}</span>
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
          data-testid="wireout-minter-mismatch"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          The app&apos;s minter differs from the server&apos;s cash-book minter.
          Actions are disabled.
        </p>
      )}

      {section.state === "unsupported" && (
        <p
          data-testid="wireout-unsupported"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          {section.unsupportedReason}
        </p>
      )}
      {section.state === "loading" && (
        <div
          data-testid="wireout-loading"
          role="status"
          className="flex flex-col gap-[8px]"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[36px] animate-pulse rounded-[4px]"
              style={{ backgroundColor: "rgba(191,189,187,0.2)" }}
            />
          ))}
        </div>
      )}
      {section.state === "error" && section.error && (
        <div
          role="alert"
          data-testid="wireout-error"
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
          data-testid="wireout-empty"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          {section.emptyMessage}
        </p>
      )}
      {section.state === "ready" && (
        <div className="overflow-x-auto">
          <table
            data-testid="wireout-table"
            className="w-full min-w-[1040px] table-fixed text-left"
          >
            <colgroup>
              {["6%", "20%", "14%", "13%", "16%", "13%", "18%"].map(
                (width, index) => (
                  <col key={index} style={{ width }} />
                ),
              )}
            </colgroup>
            <thead style={{ color: INK_MUTED }}>
              <tr>
                <th className={HEAD_CELL_CLASS}>ID</th>
                <th className={HEAD_CELL_CLASS}>Lender</th>
                <th className={`${HEAD_CELL_CLASS} text-right`}>Amount</th>
                <th className={HEAD_CELL_CLASS}>Requested at</th>
                <th className={HEAD_CELL_CLASS}>Status</th>
                <th className={HEAD_CELL_CLASS}>On-chain</th>
                <th className={`${HEAD_CELL_CLASS} pr-0`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, index) => (
                <WireOutTableRow
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

      {section.settle && (
        <SettleWireOutDialog section={section} state={section.settle} />
      )}
      {section.cancel && (
        <CancelWireOutDialog section={section} state={section.cancel} />
      )}
    </div>
  );
}

function SettledDetail({ row }: { row: WireOutRow }) {
  if (row.status === "Settled") {
    return (
      <div
        data-testid={`wireout-row-${row.id}-settled`}
        className={`${HINT_CLASS} flex flex-col`}
        style={{ color: INK_MUTED }}
      >
        <span>Settled {row.settledAt}</span>
        <span>Value date {row.valueDate}</span>
        {row.refHash && (
          <span className="font-mono" title={row.refHash}>
            {shortHash(row.refHash)}
          </span>
        )}
      </div>
    );
  }
  if (row.status === "Cancelled") {
    return (
      <div
        data-testid={`wireout-row-${row.id}-cancelled`}
        className={HINT_CLASS}
        style={{ color: INK_MUTED }}
      >
        Cancelled {row.cancelledAt}
      </div>
    );
  }
  return null;
}

function WireOutTableRow({
  row,
  index,
  section,
}: {
  row: WireOutRow;
  index: number;
  section: Section;
}) {
  const pending = row.status === "Pending";
  const settleReason = pending
    ? section.actionReason(row, "settle_wire_out")
    : null;
  const cancelReason = pending
    ? section.actionReason(row, "cancel_wire_out")
    : null;
  const reason = settleReason ?? cancelReason;
  return (
    <tr
      data-testid={`wireout-row-${row.id}`}
      style={index === 0 ? undefined : { borderTop: `1px solid ${LINE_COLOR}` }}
    >
      <td className={`${BODY_CELL_CLASS} tabular-nums`}>#{row.id}</td>
      <td className={BODY_CELL_CLASS}>
        <div className="flex flex-col items-start gap-[4px]">
          {row.lpId === null ? (
            <span data-testid={`wireout-row-${row.id}-lender`}>
              {row.lenderName}
            </span>
          ) : (
            <Link
              to="/lp-counterparties/$id"
              params={{ id: String(row.lpId) }}
              data-testid={`wireout-row-${row.id}-lender`}
              className="underline"
            >
              {row.lenderName}
            </Link>
          )}
          <AddressChip value={row.lp} testId={`wireout-row-${row.id}-lp`} />
        </div>
      </td>
      <td
        className={`${BODY_CELL_CLASS} text-right whitespace-nowrap tabular-nums`}
      >
        {row.amount}
      </td>
      <td className={BODY_CELL_CLASS}>{row.requestedAt}</td>
      <td className={BODY_CELL_CLASS}>
        <div className="flex flex-col items-start gap-[6px]">
          <StatusChip
            band={statusBand(row.status)}
            label={row.status}
            testId={`wireout-row-${row.id}-status`}
          />
          <SettledDetail row={row} />
        </div>
      </td>
      <td className={BODY_CELL_CLASS}>
        {row.chainState === null ? (
          <span style={{ color: INK_MUTED }}>{row.chainLabel}</span>
        ) : (
          <StatusChip
            band={chainBand(row.chainState)}
            label={row.chainLabel}
            testId={`wireout-row-${row.id}-chain`}
          />
        )}
      </td>
      <td className={`${BODY_CELL_CLASS} pr-0`}>
        {pending && (
          <div className="flex flex-col items-start gap-[6px]">
            <div className="flex flex-wrap gap-[8px]">
              <Button
                variant="primary-blue"
                size="compact"
                className={ACTION_BUTTON_CLASS}
                data-testid={`wireout-row-${row.id}-settle`}
                disabled={settleReason !== null}
                title={settleReason ?? undefined}
                onClick={() => section.openSettle(row)}
              >
                Settle
              </Button>
              <Button
                variant="secondary"
                size="compact"
                className={`${ACTION_BUTTON_CLASS} ${DETAIL_SECONDARY_BUTTON_CLASS}`}
                style={detailSecondaryButtonStyle()}
                data-testid={`wireout-row-${row.id}-cancel`}
                disabled={cancelReason !== null}
                title={cancelReason ?? undefined}
                onClick={() => void section.openCancel(row)}
              >
                Cancel
              </Button>
            </div>
            {reason && (
              <span
                data-testid={`wireout-row-${row.id}-reason`}
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

function WireOutSummary({
  row,
  amount,
  children,
}: {
  row: WireOutRow;
  amount: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <KeyValueRow label="Wire-out">#{row.id}</KeyValueRow>
      <KeyValueRow label="Lender">{row.lenderName}</KeyValueRow>
      <KeyValueRow label="Lender address">
        <span className="font-mono text-[13px] leading-[18px] break-all">
          {row.lp}
        </span>
      </KeyValueRow>
      <KeyValueRow label="Requested amount">{amount}</KeyValueRow>
      <KeyValueRow label="Requested at" isLast={!children}>
        {row.requestedAt}
      </KeyValueRow>
      {children}
    </div>
  );
}

function SettleWireOutDialog({
  section,
  state,
}: {
  section: Section;
  state: SettleDialogState;
}) {
  const dialogRef = useLpReviewDialog<HTMLDivElement>(
    section.closeSettle,
    state.submitting,
  );
  const invalid = settleValidation(state);
  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="wireout-settle-backdrop"
      onClick={() => {
        if (!state.submitting) section.closeSettle();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wireout-settle-title"
        tabIndex={-1}
        data-testid="wireout-settle-dialog"
        className={DIALOG_CLASS}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="wireout-settle-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Settle wire-out #{state.row.id}
        </h2>
        <p className="text-pipeline-ink-muted text-sm">
          Burns the escrowed PLUSD and takes the cash out of the bank balance.
          Send the bank wire first, then enter its reference; it can be used
          once.
        </p>
        <WireOutSummary row={state.row} amount={state.row.amount}>
          <KeyValueRow label="Destination bank account" isLast>
            <span className="flex flex-col">
              <span data-testid="wireout-settle-destination">—</span>
              <span
                data-testid="wireout-settle-destination-hint"
                className={HINT_CLASS}
                style={{ color: INK_MUTED }}
              >
                {NO_BANK_ACCOUNT_HINT}
              </span>
            </span>
          </KeyValueRow>
        </WireOutSummary>
        <label className="flex flex-col gap-2 text-sm">
          Amount wired (PLUSD)
          <input
            type="text"
            inputMode="decimal"
            data-testid="wireout-settle-amount"
            className={INPUT_CLASS}
            value={state.amountInput}
            disabled={state.submitting}
            onChange={(event) => section.setAmountInput(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          Value date
          <input
            type="date"
            data-testid="wireout-settle-date"
            className={INPUT_CLASS}
            max={todayUtcDateInput()}
            value={state.valueDateInput}
            disabled={state.submitting}
            onChange={(event) => section.setValueDateInput(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          Outgoing bank reference
          <input
            type="text"
            data-testid="wireout-settle-reference"
            className={INPUT_CLASS}
            value={state.reference}
            disabled={state.submitting}
            onChange={(event) => section.setReference(event.target.value)}
          />
        </label>
        {invalid && (
          <p
            role="alert"
            data-testid="wireout-settle-validation"
            className={HINT_CLASS}
          >
            {invalid}
          </p>
        )}
        <KeyValueRow label="Reference hash" isLast>
          <span
            data-testid="wireout-settle-hash"
            className="font-mono text-[13px] leading-[18px] break-all"
          >
            {state.refHash ?? "—"}
          </span>
        </KeyValueRow>
        {state.error && (
          <div role="alert" data-testid="wireout-settle-error">
            <InlineError
              message={state.error.message}
              details={state.error.details}
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
            disabled={state.submitting}
            onClick={section.closeSettle}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary-blue"
            size="m"
            data-testid="wireout-settle-confirm"
            disabled={invalid !== null || state.submitting}
            onClick={() => void section.confirmSettle()}
          >
            {state.submitting
              ? escrowStageLabel(section.settleStage, "Checking…")
              : "Settle wire-out"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const AUTH_COPY: Partial<Record<CancelDialogState["phase"], string>> = {
  reading: "Reading this lender's PLUSD authorisation…",
  authorized: "This lender's address is authorised to hold PLUSD.",
  "not-authorized": `${LP_NOT_AUTHORIZED_COPY} Cancel is blocked until it is authorised again.`,
  "no-trustline": "This lender's address has no PLUSD trustline.",
};

function CancelWireOutDialog({
  section,
  state,
}: {
  section: Section;
  state: CancelDialogState;
}) {
  const dialogRef = useLpReviewDialog<HTMLDivElement>(
    section.closeCancel,
    state.submitting,
  );
  const authCopy = AUTH_COPY[state.phase];
  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="wireout-cancel-backdrop"
      onClick={() => {
        if (!state.submitting) section.closeCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wireout-cancel-title"
        tabIndex={-1}
        data-testid="wireout-cancel-dialog"
        className={DIALOG_CLASS}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="wireout-cancel-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Cancel wire-out #{state.row.id}
        </h2>
        <p className="text-pipeline-ink-muted text-sm">
          The escrowed PLUSD returns to the lender&apos;s address.
        </p>
        <WireOutSummary row={state.row} amount={state.row.amount} />
        {authCopy && (
          <p
            role="status"
            data-testid="wireout-cancel-auth"
            className={BODY_CLASS}
            style={{ color: INK_MUTED }}
          >
            {authCopy}
          </p>
        )}
        {state.error && (
          <div role="alert" data-testid="wireout-cancel-error">
            <InlineError
              message={state.error.message}
              details={state.error.details}
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
            disabled={state.submitting}
            onClick={section.closeCancel}
          >
            Keep request
          </Button>
          <Button
            type="button"
            variant="primary-blue"
            size="m"
            data-testid="wireout-cancel-confirm"
            disabled={state.phase !== "authorized" || state.submitting}
            onClick={() => void section.confirmCancel()}
          >
            {state.submitting
              ? escrowStageLabel(section.cancelStage, "Checking…")
              : "Cancel wire-out"}
          </Button>
        </div>
      </div>
    </div>
  );
}

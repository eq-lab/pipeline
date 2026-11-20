// spec: docs/frontend/trustee-flows.md#cash-management--escrowed-wires
import { Button, InlineError } from "@pipeline/ui";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import { StatusChip } from "@/components/detail/StatusChip";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  INK_MUTED,
  LINE_COLOR,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import { truncateAddress } from "@/lib/truncateAddress";
import { formatUsdExact } from "@/utils/formatUsd";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import {
  escrowResultMessage,
  escrowStageLabel,
  returnReferenceError,
  useEscrowedWiresSection,
  type AssignDialogState,
  type EscrowRow,
  type EscrowedWiresSection as Section,
  type ReturnDialogState,
} from "./-escrowed-wires";

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

function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

function chainBand(state: EscrowRow["chainState"]) {
  if (state === "confirmed") return "positive" as const;
  if (state === "mismatch" || state === "read-error")
    return "negative" as const;
  return "attention" as const;
}

export function EscrowedWiresSection() {
  const section = useEscrowedWiresSection();
  return (
    <div
      data-testid="cash-management-escrow"
      className="flex w-full flex-col gap-[16px] rounded-[4px] bg-white px-[27px] py-[25px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      <div className="flex flex-col gap-[2px]">
        <span className="flex items-center gap-[10px]">
          <span className="font-[family-name:var(--font-display)] text-[20px] leading-[28px] text-[#262524]">
            Escrowed wires
          </span>
          <span
            data-testid="cash-management-escrow-chain"
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
          Unmatched incoming wires held by the minter on {section.chainLabel} —
          assign each to its lender or return it.
        </span>
      </div>

      {section.lastResult && (
        <div
          role="status"
          data-testid="escrow-result"
          className="flex flex-wrap items-start justify-between gap-[12px] rounded-[4px] px-[15px] py-[13px] font-[family-name:var(--font-body)] text-[14px] break-all"
          style={{
            backgroundColor: "rgba(32,128,0,0.08)",
            color: "var(--color-pipeline-positive-primary)",
          }}
        >
          <span>{escrowResultMessage(section.lastResult)}</span>
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
          data-testid="escrow-minter-mismatch"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          The app&apos;s minter differs from the server&apos;s cash-book minter.
          Actions are disabled.
        </p>
      )}

      {section.state === "unsupported" && (
        <p
          data-testid="escrow-unsupported"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          {section.unsupportedReason}
        </p>
      )}
      {section.state === "loading" && (
        <div
          data-testid="escrow-loading"
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
          data-testid="escrow-error"
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
          data-testid="escrow-empty"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          No incoming wires are in escrow.
        </p>
      )}
      {section.state === "ready" && (
        <div className="overflow-x-auto">
          <table
            data-testid="escrow-table"
            className="w-full min-w-[980px] table-fixed text-left"
          >
            <colgroup>
              {["7%", "15%", "14%", "15%", "14%", "17%", "18%"].map(
                (width, index) => (
                  <col key={index} style={{ width }} />
                ),
              )}
            </colgroup>
            <thead style={{ color: INK_MUTED }}>
              <tr>
                <th className={HEAD_CELL_CLASS}>Wire</th>
                <th className={`${HEAD_CELL_CLASS} text-right`}>Amount</th>
                <th className={HEAD_CELL_CLASS}>Value date</th>
                <th className={HEAD_CELL_CLASS}>Bank reference hash</th>
                <th className={HEAD_CELL_CLASS}>Recorded at</th>
                <th className={HEAD_CELL_CLASS}>On-chain status</th>
                <th className={`${HEAD_CELL_CLASS} pr-0`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, index) => (
                <WireRow
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

      {section.assign && (
        <AssignWireDialog section={section} state={section.assign} />
      )}
      {section.ret && (
        <ReturnWireDialog section={section} state={section.ret} />
      )}
    </div>
  );
}

function WireRow({
  row,
  index,
  section,
}: {
  row: EscrowRow;
  index: number;
  section: Section;
}) {
  const assignReason = section.actionReason(row, "assign_wire_in");
  const returnReason = section.actionReason(row, "return_wire_in");
  const reason = assignReason ?? returnReason;
  return (
    <tr
      data-testid={`escrow-row-${row.id}`}
      style={index === 0 ? undefined : { borderTop: `1px solid ${LINE_COLOR}` }}
    >
      <td className={`${BODY_CELL_CLASS} tabular-nums`}>#{row.id}</td>
      <td
        className={`${BODY_CELL_CLASS} text-right whitespace-nowrap tabular-nums`}
      >
        {row.amount}
      </td>
      <td className={BODY_CELL_CLASS}>{row.valueDate}</td>
      <td
        className={`${BODY_CELL_CLASS} font-mono text-[13px]`}
        title={row.refHash}
      >
        {shortHash(row.refHash)}
      </td>
      <td className={BODY_CELL_CLASS}>{row.recordedAt}</td>
      <td className={BODY_CELL_CLASS}>
        <StatusChip
          band={chainBand(row.chainState)}
          label={row.chainLabel}
          testId={`escrow-row-${row.id}-chain`}
        />
      </td>
      <td className={`${BODY_CELL_CLASS} pr-0`}>
        <div className="flex flex-col items-start gap-[6px]">
          <div className="flex flex-wrap gap-[8px]">
            <Button
              variant="primary-blue"
              size="compact"
              className={ACTION_BUTTON_CLASS}
              data-testid={`escrow-row-${row.id}-assign`}
              disabled={assignReason !== null}
              title={assignReason ?? undefined}
              onClick={() => section.openAssign(row)}
            >
              Assign to lender
            </Button>
            <Button
              variant="secondary"
              size="compact"
              className={`${ACTION_BUTTON_CLASS} ${DETAIL_SECONDARY_BUTTON_CLASS}`}
              style={detailSecondaryButtonStyle()}
              data-testid={`escrow-row-${row.id}-return`}
              disabled={returnReason !== null}
              title={returnReason ?? undefined}
              onClick={() => section.openReturn(row)}
            >
              Return
            </Button>
          </div>
          {reason && (
            <span
              data-testid={`escrow-row-${row.id}-reason`}
              className={HINT_CLASS}
              style={{ color: INK_MUTED }}
            >
              {reason}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function WireSummary({ row }: { row: EscrowRow }) {
  return (
    <div className="flex flex-col">
      <KeyValueRow label="Wire">#{row.id}</KeyValueRow>
      <KeyValueRow label="Amount">{formatUsdExact(row.amountRaw)}</KeyValueRow>
      <KeyValueRow label="Value date" isLast>
        {row.valueDate}
      </KeyValueRow>
    </div>
  );
}

const AUTH_COPY: Partial<Record<AssignDialogState["phase"], string>> = {
  reading: "Reading this lender's PLUSD authorisation…",
  authorized: "This lender's address is authorised to hold PLUSD.",
  "not-authorized":
    "This lender's address is not authorised to hold PLUSD. It cannot receive this wire.",
  "no-trustline": "This lender's address has no PLUSD trustline.",
};

function AssignWireDialog({
  section,
  state,
}: {
  section: Section;
  state: AssignDialogState;
}) {
  const dialogRef = useLpReviewDialog<HTMLDivElement>(
    section.closeAssign,
    state.submitting,
  );
  const authCopy = AUTH_COPY[state.phase];
  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="escrow-assign-backdrop"
      onClick={() => {
        if (!state.submitting) section.closeAssign();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escrow-assign-title"
        tabIndex={-1}
        data-testid="escrow-assign-dialog"
        className={DIALOG_CLASS}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="escrow-assign-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Assign wire #{state.row.id} to a lender
        </h2>
        <p className="text-pipeline-ink-muted text-sm">
          The escrowed PLUSD is staked for the lender&apos;s linked Stellar
          settlement address.
        </p>
        <WireSummary row={state.row} />
        <label className="flex flex-col gap-2 text-sm">
          Lender
          <select
            data-testid="escrow-assign-lp"
            className={INPUT_CLASS}
            value={state.lpId ?? ""}
            disabled={state.submitting}
            onChange={(event) =>
              void section.selectLp(
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
          >
            <option value="">Select a lender…</option>
            {section.lps.map((lp) => (
              <option key={lp.id} value={lp.id}>
                {lp.legal_name} — {truncateAddress(lp.stellar_address ?? "")}
              </option>
            ))}
          </select>
        </label>
        {state.notice && (
          <p
            role="alert"
            data-testid="escrow-assign-notice"
            className={BODY_CLASS}
          >
            {state.notice}
          </p>
        )}
        {state.receiver && (
          <KeyValueRow label="Receiver" isLast>
            <span
              data-testid="escrow-assign-receiver"
              className="font-mono text-[13px] leading-[18px] break-all"
            >
              {state.receiver}
            </span>
          </KeyValueRow>
        )}
        {authCopy && (
          <p
            role="status"
            data-testid="escrow-assign-auth"
            className={BODY_CLASS}
            style={{ color: INK_MUTED }}
          >
            {authCopy}
          </p>
        )}
        {state.error && (
          <div role="alert" data-testid="escrow-assign-error">
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
            onClick={section.closeAssign}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary-blue"
            size="m"
            data-testid="escrow-assign-confirm"
            disabled={state.phase !== "authorized" || state.submitting}
            onClick={() => void section.confirmAssign()}
          >
            {state.submitting
              ? escrowStageLabel(section.assignStage, "Checking…")
              : "Assign wire"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReturnWireDialog({
  section,
  state,
}: {
  section: Section;
  state: ReturnDialogState;
}) {
  const dialogRef = useLpReviewDialog<HTMLDivElement>(
    section.closeReturn,
    state.submitting,
  );
  const invalid = returnReferenceError(state.reference);
  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="escrow-return-backdrop"
      onClick={() => {
        if (!state.submitting) section.closeReturn();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escrow-return-title"
        tabIndex={-1}
        data-testid="escrow-return-dialog"
        className={DIALOG_CLASS}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="escrow-return-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Return wire #{state.row.id}
        </h2>
        <p className="text-pipeline-ink-muted text-sm">
          Burns the escrowed PLUSD and takes the cash back out. Enter the
          outgoing wire&apos;s bank reference; it can be used once.
        </p>
        <WireSummary row={state.row} />
        <label className="flex flex-col gap-2 text-sm">
          Outgoing bank reference
          <input
            type="text"
            data-testid="escrow-return-reference"
            className={INPUT_CLASS}
            value={state.reference}
            disabled={state.submitting}
            onChange={(event) => section.setReference(event.target.value)}
          />
        </label>
        {state.reference !== "" && invalid && (
          <p
            role="alert"
            data-testid="escrow-return-validation"
            className={HINT_CLASS}
          >
            {invalid}
          </p>
        )}
        {state.refHash && !invalid && (
          <KeyValueRow label="Reference hash" isLast>
            <span
              data-testid="escrow-return-hash"
              className="font-mono text-[13px] leading-[18px] break-all"
            >
              {state.refHash}
            </span>
          </KeyValueRow>
        )}
        {state.error && (
          <div role="alert" data-testid="escrow-return-error">
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
            onClick={section.closeReturn}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary-blue"
            size="m"
            data-testid="escrow-return-confirm"
            disabled={invalid !== null || state.submitting}
            onClick={() => void section.confirmReturn()}
          >
            {state.submitting
              ? escrowStageLabel(section.returnStage, "Checking…")
              : "Return wire"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { useEffect } from "react";
import { InlineError } from "@pipeline/ui";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import { BRAND, INK_MUTED, LINE_COLOR } from "@/components/detail/detailTokens";
import {
  formatChainAmount,
  formatValueDate,
  roleLine,
  stageLabel,
} from "./-repayment-recovery";
import { useRepaymentRecoveryDialog } from "./-useRepaymentRecoveryDialog";

const REVERSE_LABEL = {
  "execute-now": "Reverse repayment",
  schedule: "Schedule reversal",
  "execute-scheduled": "Execute reversal",
  "no-role": "Reverse repayment",
} as const;

const SECTION_TITLE =
  "font-[family-name:var(--font-body)] text-[11px] tracking-[0.08em] uppercase";
const BODY = "font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]";

export function RepaymentRecoveryDialog({
  open,
  chainId,
  loanId,
  loanName,
  onchainStatus,
  onClose,
}: {
  open: boolean;
  chainId: number;
  loanId: string;
  loanName: string;
  onchainStatus: string | null;
  onClose: () => void;
}) {
  const view = useRepaymentRecoveryDialog(chainId, loanId, onchainStatus, open);
  const busy = view.reversePending || view.step2.pending;

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const reversed = view.selectedRow?.reversed === true;
  const reverseDisabled =
    busy ||
    reversed ||
    view.selectedRow === null ||
    view.action === null ||
    view.action === "no-role";

  return (
    <div
      data-testid="repayment-recovery-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="repayment-recovery-title"
        data-testid="repayment-recovery-dialog"
        className="flex max-h-[calc(100vh-32px)] w-[640px] max-w-[calc(100vw-32px)] flex-col gap-[16px] overflow-y-auto rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-[8px]">
          <h2
            id="repayment-recovery-title"
            className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
          >
            Repayment recovery
          </h2>
          <p className={BODY} style={{ color: INK_MUTED }}>
            {loanName}: reverse the mis-split repayment, then record it again
            with the corrected split.
          </p>
        </div>

        {view.loadError && (
          <InlineError
            message={view.loadError.message}
            details={view.loadError.details}
            className="block text-[13px]"
          />
        )}
        {view.loading && (
          <p className={BODY} style={{ color: INK_MUTED }}>
            Loading repayments…
          </p>
        )}

        <section
          data-testid="repayment-recovery-step1"
          className="flex flex-col gap-[12px]"
        >
          <p className={SECTION_TITLE} style={{ color: INK_MUTED }}>
            Step 1. Reverse the repayment
          </p>
          {view.candidates.length === 0 && !reversed && !view.loading && (
            <p className={BODY} style={{ color: INK_MUTED }}>
              No repayment to reverse on this loan.
            </p>
          )}
          {view.candidates.map((row) => (
            <label
              key={row.repaymentId}
              className="flex cursor-pointer flex-col gap-[4px] rounded-[4px] border border-solid p-[12px]"
              style={{ borderColor: LINE_COLOR }}
            >
              <span className="flex items-center gap-[8px] font-[family-name:var(--font-body)] text-[15px] text-[#262524]">
                <input
                  type="radio"
                  name="repayment"
                  data-testid={`repayment-recovery-radio-${row.repaymentId}`}
                  checked={view.selectedId === row.repaymentId}
                  disabled={busy}
                  onChange={() => view.select(row.repaymentId)}
                />
                Repayment #{row.repaymentId}
                {row.suspect && (
                  <span className="text-[12px]" style={{ color: INK_MUTED }}>
                    principal booked as equity
                  </span>
                )}
              </span>
              {view.selectedId === row.repaymentId && (
                <div data-testid="repayment-recovery-split">
                  {row.fields.map((field, i) => (
                    <KeyValueRow
                      key={field.label}
                      label={field.label}
                      isLast={i === row.fields.length - 1}
                    >
                      {field.value}
                    </KeyValueRow>
                  ))}
                </div>
              )}
            </label>
          ))}
          {reversed && (
            <p
              data-testid="repayment-recovery-reversed"
              className={BODY}
              style={{ color: INK_MUTED }}
            >
              Repayment #{view.selectedId} is reversed on-chain.
            </p>
          )}
          {view.selectedRow && !reversed && (
            <div data-testid="repayment-recovery-effects">
              <p className={SECTION_TITLE} style={{ color: INK_MUTED }}>
                Effects of the reversal
              </p>
              {view.effects.map((effect, i) => (
                <KeyValueRow
                  key={effect.label}
                  label={effect.label}
                  isLast={i === view.effects.length - 1}
                >
                  {effect.value}
                </KeyValueRow>
              ))}
            </div>
          )}
          {!reversed && view.selectedRow && (
            <p
              data-testid="repayment-recovery-role"
              className={BODY}
              style={{ color: INK_MUTED }}
            >
              {roleLine(view.action, view.delaySeconds, view.readyAt)}
            </p>
          )}
          {view.reverseError && (
            <div data-testid="repayment-recovery-reverse-error">
              <InlineError
                message={view.reverseError.message}
                details={view.reverseError.details}
                className="block text-[13px]"
              />
            </div>
          )}
          {!reversed && (
            <button
              type="button"
              data-testid="repayment-recovery-reverse"
              disabled={reverseDisabled}
              onClick={view.reverse}
              className="h-[40px] w-fit rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {view.reversePending
                ? stageLabel(view.reverseStage, "Submitting…")
                : REVERSE_LABEL[view.action ?? "execute-now"]}
            </button>
          )}
        </section>

        <section
          data-testid="repayment-recovery-step2"
          className="flex flex-col gap-[12px]"
        >
          <p className={SECTION_TITLE} style={{ color: INK_MUTED }}>
            Step 2. Record the corrected repayment
          </p>
          {view.step2.corrected && view.step2.valueDate !== null && (
            <div data-testid="repayment-recovery-corrected">
              {(
                [
                  ["Offtaker received", view.step2.corrected.offtaker_received],
                  [
                    "Senior principal repaid",
                    view.step2.corrected.senior_principal_repaid,
                  ],
                  ["Senior interest", view.step2.corrected.senior_interest],
                  [
                    "Equity distributed",
                    view.step2.corrected.equity_distributed,
                  ],
                  ["Management fee", view.step2.corrected.mgmt_fee],
                  ["Performance fee", view.step2.corrected.perf_fee],
                  ["OET allocation", view.step2.corrected.oet_alloc],
                ] as const
              ).map(([label, raw]) => (
                <KeyValueRow key={label} label={label}>
                  {formatChainAmount(raw, chainId)}
                </KeyValueRow>
              ))}
              <KeyValueRow label="Value date" isLast>
                {formatValueDate(view.step2.valueDate)}
              </KeyValueRow>
            </div>
          )}
          {view.step2.blockedReason && (
            <p
              data-testid="repayment-recovery-step2-blocked"
              className={BODY}
              style={{ color: INK_MUTED }}
            >
              {view.step2.blockedReason}
            </p>
          )}
          {view.step2.error && (
            <div data-testid="repayment-recovery-record-error">
              <InlineError
                message={view.step2.error.message}
                details={view.step2.error.details}
                className="block text-[13px]"
              />
            </div>
          )}
          {view.step2.hash ? (
            <p
              data-testid="repayment-recovery-hash"
              className={`${BODY} break-all`}
            >
              Corrected repayment recorded. Transaction {view.step2.hash}. Close
              the loan from Record Repayment once its checklist is green.
            </p>
          ) : (
            <button
              type="button"
              data-testid="repayment-recovery-record"
              disabled={!view.step2.enabled || view.step2.pending}
              onClick={view.step2.record}
              className="h-[40px] w-fit rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {view.step2.pending
                ? stageLabel(view.step2.stage, "Recording…")
                : "Record corrected repayment"}
            </button>
          )}
        </section>

        <div className="flex justify-end">
          <button
            type="button"
            data-testid="repayment-recovery-close"
            onClick={onClose}
            disabled={busy}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

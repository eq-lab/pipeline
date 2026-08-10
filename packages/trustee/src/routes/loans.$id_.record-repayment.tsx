import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRecordRepayment, type WaterfallRow } from "./-record-repayment";
import { useRecordPayment } from "@/api/useRecordPayment";
import { useCloseLoan } from "@/api/useCloseLoan";
import { toUserError } from "@/utils/userError";
import { InlineError } from "@pipeline/ui";

/**
 * Record Repayment — Principal full-page route (issue #884, Figma node
 * `4116-11621`) — the destination opened by clicking the existing "Close
 * loan" other-action on the loan-detail page (`loans.$id.tsx`; that action
 * does NOT close the loan directly — it opens this page, where the trustee
 * records the final principal repayment and only then closes the loan).
 *
 * A full-screen page, not a modal, mirroring the Record Coupon route
 * (`loans.$id_.record-coupon.tsx`, #882) — registered as a NON-nested child
 * of the `/loans` layout via the `$id_` trailing-underscore file-name escape,
 * for the same reason that route's doc comment describes.
 *
 * ## Scope
 * Previews the payment waterfall for a trustee-entered final offtaker
 * payment via `useLoanWaterfall`, then records it on-chain via
 * `useRecordPayment` (`record_payment`, the same write #882 uses). Unlike the
 * coupon page, `Senior principal returned` here is the REAL waterfall figure
 * (this is a principal repayment, not an interest-only coupon) — see
 * `-record-repayment.ts`'s module doc.
 *
 * ## Close loan (new on-chain write, issue #884)
 * Once the loan is fully repaid (`view.showCloseLoan`), a second action
 * appears that calls `useCloseLoan` (`close_loan`) with the resolved
 * `ClosureReason` (`view.closureReason` — `ScheduledMaturity` at/after
 * maturity, else `EarlyRepayment`) and navigates back to the loan detail page
 * on success.
 *
 * ## Chips (never-fabricate)
 * Only the static "Your key · no cash moves" copy chip renders — the Figma's
 * "Recorded · 24 Jun" progress chip is omitted (no backend source ever marks
 * a repayment "recorded" on this page), mirroring #882's chip policy.
 *
 * Per `docs/FRONTEND.md` rule 2, this `.tsx` is JSX/styling only; all data
 * wiring + value→display mapping lives in the colocated `-record-repayment.ts`
 * view-model hook.
 */

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
const INK_MUTED = "rgba(56,55,53,0.6)";
const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";
const BRAND = "var(--color-pipeline-brand)";

/** Progress copy for each `record_payment` stage, shown on the record button. */
function recordStageLabel(stage: string | null): string {
  switch (stage) {
    case "awaiting-signature":
      return "Waiting for wallet signature…";
    case "submitting":
      return "Submitting on-chain…";
    case "confirming":
      return "Confirming…";
    default:
      return "Recording…";
  }
}

/** Progress copy for each `close_loan` stage, shown on the close-loan button. */
function closeStageLabel(stage: string | null): string {
  switch (stage) {
    case "awaiting-signature":
      return "Waiting for wallet signature…";
    case "submitting":
      return "Submitting on-chain…";
    case "confirming":
      return "Confirming…";
    default:
      return "Closing…";
  }
}

// Muted surface fill behind the input boxes and the waterfall step badges —
// the exact Figma fill (matching Record Coupon, node `4116-11295`), a light
// warm grey distinct from the ink-based `--color-pipeline-surface-muted` token.
const FIELD_FILL = "rgba(191,189,187,0.12)";

// The input is a single filled/bordered box holding its label (small, top) and
// the field itself (borderless, transparent) — the Figma "Overlay+Border"
// pattern, NOT a bare bordered input with an outside label.
const FIELD_BOX =
  "flex flex-col gap-[3px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[15px] py-[11px]";
const FIELD_LABEL_CLASS =
  "font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]";
const FIELD_INPUT_CLASS =
  "w-full bg-transparent font-[family-name:var(--font-body)] text-[17px] text-[#262524] outline-none disabled:cursor-default";

function TermRow({
  label,
  value,
  isLast,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <div
      className="flex items-end justify-between py-[12px]"
      style={isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }}
    >
      <span
        className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
        style={{ color: INK_MUTED }}
      >
        {label}
      </span>
      <span className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
        {value}
      </span>
    </div>
  );
}

function WaterfallRowView({
  row,
  step,
  isLast,
  isCalculating,
}: {
  row: WaterfallRow;
  /** 1-based step number shown in the row's circular badge (Figma node `4116-11295`). */
  step: number;
  isLast: boolean;
  /** Masks the value with a pulse skeleton while a recalculation is pending (#1049). */
  isCalculating: boolean;
}) {
  return (
    <div
      data-testid="record-repayment-waterfall-row"
      className="flex items-start gap-[14px] py-[12px]"
      style={{
        ...(isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }),
        ...(row.disabled ? { opacity: 0.5 } : undefined),
      }}
    >
      <span
        aria-hidden="true"
        className="flex size-[22px] shrink-0 items-center justify-center rounded-full font-[family-name:var(--font-body)] text-[12px] leading-none"
        style={{ backgroundColor: FIELD_FILL, color: INK_MUTED }}
      >
        {step}
      </span>
      <span className="flex flex-1 flex-col gap-[2px]">
        <span className="font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
          {row.label}
        </span>
        {row.sub && (
          <span
            className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ color: INK_MUTED }}
          >
            {row.sub}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] font-semibold text-[#262524]">
        {isCalculating ? (
          <span
            data-testid="record-repayment-waterfall-value-loading"
            aria-hidden="true"
            className="inline-block h-[20px] w-[72px] animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)] align-middle"
          />
        ) : (
          row.value
        )}
      </span>
    </div>
  );
}

function RecordRepayment() {
  const { id } = Route.useParams();
  const view = useRecordRepayment(id);
  const navigate = useNavigate();
  const record = useRecordPayment();
  const closeLoan = useCloseLoan();
  // Not threaded through `-record-repayment.ts` — `record`/`closeLoan` are
  // page-level mutations, not part of the presenter's read view-model (spec:
  // docs/frontend/error-handling.md).
  const recordError = record.error
    ? toUserError(record.error, "Failed to record this payment.")
    : null;
  const closeLoanError = closeLoan.error
    ? toUserError(closeLoan.error, "Failed to close this loan.")
    : null;

  const onRecord = () => {
    if (view.recordPaymentInput == null) return;
    record.reset();
    void record
      .mutateAsync({ loanId: Number(id), repayment: view.recordPaymentInput })
      .catch(() => {
        // Error surfaces inline via `record.error`; stay on the page to retry.
      });
  };

  const onCloseLoan = () => {
    if (view.closureReason == null) return;
    closeLoan.reset();
    void closeLoan
      .mutateAsync({ loanId: Number(id), reason: view.closureReason })
      .then(() => navigate({ to: "/loans/$id", params: { id } }))
      .catch(() => {
        // Error surfaces inline via `closeLoan.error`; stay on the page to retry.
      });
  };

  if (view.state === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[24px] px-[56px] pt-[39px] pb-[80px]">
        <div
          data-testid="record-repayment-loading"
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading loan"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[80px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      </main>
    );
  }

  if (view.state === "error") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[24px] px-[56px] pt-[39px] pb-[80px]">
        <Link
          to="/loans/$id"
          params={{ id }}
          className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
        >
          {view.backLabel}
        </Link>
        <div
          data-testid="record-repayment-error"
          className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
        >
          <InlineError
            message={view.errorMessage ?? "Failed to load the loan."}
            details={view.errorDetails ?? undefined}
          />
        </div>
      </main>
    );
  }

  if (view.state === "not-found") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[24px] px-[56px] pt-[39px] pb-[80px]">
        <p
          data-testid="record-repayment-not-found"
          className="font-[family-name:var(--font-body)] text-[16px] text-[rgba(56,55,53,0.6)]"
        >
          Loan not found.{" "}
          <Link to="/loans" className="text-[#000080] underline">
            Back to Loans
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[24px] px-[56px] pt-[39px] pb-[80px]">
      <div className="flex flex-col gap-[8px]">
        <Link
          to="/loans/$id"
          params={{ id }}
          className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
        >
          {view.backLabel}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
          Record Repayment — Principal
        </h1>
        <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
          <span
            data-testid="record-repayment-key-chip"
            className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
            style={{
              color: INK_MUTED,
              backgroundColor: "rgba(56,55,53,0.06)",
              borderColor: LINE_COLOR,
            }}
          >
            Your key · no cash moves
          </span>
        </div>
      </div>

      <div className="flex w-full gap-[20px]">
        <div
          data-testid="record-repayment-left-card"
          className="flex flex-1 flex-col gap-[16px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white p-[26px]"
        >
          <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
            {view.originator}
          </h2>
          <div>
            <TermRow label="Commodity" value={view.commodity} />
            <TermRow label="Final period" value={view.finalPeriod} />
            <TermRow
              label="Senior outstanding before"
              value={view.seniorOutstandingBefore}
            />
            <TermRow label="Offtaker owed" value={view.offtakerOwed} isLast />
          </div>
          <label className={FIELD_BOX} style={{ backgroundColor: FIELD_FILL }}>
            <span className={FIELD_LABEL_CLASS} style={{ color: INK_MUTED }}>
              Offtaker payment received (USD, Trust account)
            </span>
            {/* Principal repayment always pays the full remaining owed — the
                amount is fixed to it and read-only (no partial principal
                repayment). */}
            <input
              type="text"
              inputMode="decimal"
              data-testid="record-repayment-amount"
              value={view.amountInput}
              disabled
              className={FIELD_INPUT_CLASS}
            />
          </label>
          <label className={FIELD_BOX} style={{ backgroundColor: FIELD_FILL }}>
            <span className={FIELD_LABEL_CLASS} style={{ color: INK_MUTED }}>
              Date received
            </span>
            <input
              type="date"
              data-testid="record-repayment-date"
              value={view.dateInput}
              disabled
              className={FIELD_INPUT_CLASS}
            />
          </label>
          <p
            className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
            style={{ color: INK_MUTED }}
          >
            Check the amount against the correspondent bank wire before
            recording — there is no automatic bank feed.
          </p>
        </div>

        <div
          data-testid="record-repayment-right-card"
          className="flex flex-1 flex-col gap-[16px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white p-[26px]"
        >
          <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
            Waterfall Breakdown
          </h2>
          {view.waterfall.rows.length === 0 ? (
            <p
              data-testid="record-repayment-waterfall-empty"
              className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
              style={{ color: INK_MUTED }}
            >
              Enter the offtaker payment to preview the waterfall.
            </p>
          ) : (
            <div
              aria-busy={view.waterfall.isCalculating}
              data-testid={
                view.waterfall.isCalculating
                  ? "record-repayment-waterfall-calculating"
                  : undefined
              }
            >
              {view.waterfall.rows.map((row, i) => (
                <WaterfallRowView
                  key={row.label}
                  row={row}
                  step={i + 1}
                  isLast={i === view.waterfall.rows.length - 1}
                  isCalculating={view.waterfall.isCalculating}
                />
              ))}
            </div>
          )}
          {view.waterfall.errorMessage && (
            <div data-testid="record-repayment-waterfall-error">
              <InlineError
                message={view.waterfall.errorMessage}
                details={view.waterfall.errorDetails ?? undefined}
                className="block text-[14px] leading-[19.6px]"
              />
            </div>
          )}
          {view.summaryText && (
            <div
              data-testid="record-repayment-summary"
              className="flex items-center justify-between gap-[12px] rounded-[4px] border border-solid px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[16px] leading-[22.4px]"
              style={{
                color: POSITIVE_GREEN,
                backgroundColor: "rgba(32,128,0,0.08)",
                borderColor: "rgba(32,128,0,0.3)",
              }}
            >
              <span>{view.summaryText}</span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
                className="shrink-0"
              >
                <path
                  d="M3.75 9.5 7.5 13.25 14.25 5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
          {/* Confirm — trustee-wallet-signed on-chain `record_payment` (#884).
              Pinned to the bottom of the right card (`mt-auto`) so the actions
              stay anchored to the card floor, matching Record Coupon. */}
          <div className="mt-auto flex flex-col gap-[12px] pt-[16px]">
            {recordError && (
              <div data-testid="record-repayment-record-error">
                <InlineError
                  message={recordError.message}
                  details={recordError.details}
                  className="block text-[14px] leading-[19.6px]"
                />
              </div>
            )}
            {closeLoanError && (
              <div data-testid="record-repayment-close-error">
                <InlineError
                  message={closeLoanError.message}
                  details={closeLoanError.details}
                  className="block text-[14px] leading-[19.6px]"
                />
              </div>
            )}
            <button
              type="button"
              data-testid="record-repayment-submit"
              disabled={
                view.recordPaymentInput == null ||
                record.isPending ||
                record.isSuccess
              }
              onClick={onRecord}
              className="flex h-[48px] w-full items-center justify-center rounded-[4px] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {record.isPending
                ? recordStageLabel(record.stage)
                : record.isSuccess
                  ? "Payment recorded"
                  : "Record repayment"}
            </button>
            {/* Close loan — the sequential "next step". Always shown as a
                full-width item, but stays disabled until the payment is
                actually complete: the `record_payment` write has succeeded
                (`record.isSuccess`) or the loan was already fully repaid on
                load (`view.alreadyRepaid`). Entering a terminal amount alone no
                longer enables it. */}
            <button
              type="button"
              data-testid="record-repayment-close-submit"
              disabled={
                !view.showCloseLoan ||
                !(record.isSuccess || view.alreadyRepaid) ||
                view.closureReason == null ||
                closeLoan.isPending
              }
              onClick={onCloseLoan}
              className="flex h-[48px] w-full items-center justify-center rounded-[4px] border border-solid px-[28px] font-[family-name:var(--font-body)] text-[16px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundColor: FIELD_FILL,
                borderColor: LINE_COLOR,
                color: "#262524",
              }}
            >
              {closeLoan.isPending
                ? closeStageLabel(closeLoan.stage)
                : "Next step — close loan"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/loans/$id_/record-repayment")({
  component: RecordRepayment,
});

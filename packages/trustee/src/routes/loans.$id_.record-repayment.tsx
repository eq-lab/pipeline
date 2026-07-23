import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRecordRepayment, type WaterfallRow } from "./-record-repayment";
import { useRecordPayment } from "@/api/useRecordPayment";
import { useCloseLoan } from "@/api/useCloseLoan";

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
const INK = "var(--color-pipeline-ink)";
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

const FIELD_CLASS =
  "w-full rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[13px] py-[10px] font-[family-name:var(--font-body)] text-[17px] text-[#262524]";

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
  isLast,
}: {
  row: WaterfallRow;
  isLast: boolean;
}) {
  return (
    <div
      data-testid="record-repayment-waterfall-row"
      className="flex items-start justify-between gap-[16px] py-[12px]"
      style={{
        ...(isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }),
        ...(row.disabled ? { opacity: 0.5 } : undefined),
      }}
    >
      <span
        className="flex items-center gap-[6px] font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
        style={{ color: INK_MUTED }}
      >
        <span aria-hidden="true">•</span>
        {row.label}
      </span>
      <span className="flex flex-col items-end gap-[2px]">
        <span className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] font-semibold text-[#262524]">
          {row.value}
        </span>
        {row.sub && (
          <span
            className="text-right font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ color: INK_MUTED }}
          >
            {row.sub}
          </span>
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
          role="alert"
          data-testid="record-repayment-error"
          className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
        >
          {view.errorMessage ?? "Failed to load the loan."}
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
          <label className="flex flex-col gap-[6px] pt-[8px]">
            <span
              className="font-[family-name:var(--font-body)] text-[12px]"
              style={{ color: INK_MUTED }}
            >
              Offtaker payment received (USD, Trust account)
            </span>
            <input
              type="number"
              inputMode="decimal"
              data-testid="record-repayment-amount"
              value={view.amountInput}
              onChange={(e) => view.onAmountChange(e.target.value)}
              placeholder="e.g. 6150000"
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[6px]">
            <span
              className="font-[family-name:var(--font-body)] text-[12px]"
              style={{ color: INK_MUTED }}
            >
              Date received
            </span>
            <input
              type="date"
              data-testid="record-repayment-date"
              value={view.dateInput}
              disabled
              className={FIELD_CLASS}
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
            <div>
              {view.waterfall.rows.map((row, i) => (
                <WaterfallRowView
                  key={row.label}
                  row={row}
                  isLast={i === view.waterfall.rows.length - 1}
                />
              ))}
            </div>
          )}
          {view.waterfall.errorMessage && (
            <p
              role="alert"
              data-testid="record-repayment-waterfall-error"
              className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
              style={{ color: "#b20000" }}
            >
              {view.waterfall.errorMessage}
            </p>
          )}
          {view.summaryText && (
            <div
              data-testid="record-repayment-summary"
              className="rounded-[4px] border border-solid px-[14px] py-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
              style={{
                color: POSITIVE_GREEN,
                backgroundColor: "rgba(32,128,0,0.08)",
                borderColor: "rgba(32,128,0,0.3)",
              }}
            >
              {view.summaryText}
            </div>
          )}
          {/* Replaces the Figma's "Next stage: on-ramp →" button + footer —
              this page's next stage is closing the loan, not an on-ramp. */}
          <div
            data-testid="record-repayment-next-step"
            className="rounded-[4px] border border-solid px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
            style={{
              backgroundColor: "rgba(191,189,187,0.12)",
              borderColor: LINE_COLOR,
              color: INK,
            }}
          >
            Next step — move loan to closed
          </div>
        </div>
      </div>

      {/* Confirm — trustee-wallet-signed on-chain `record_payment` (#884). */}
      {record.error && (
        <p
          role="alert"
          data-testid="record-repayment-record-error"
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: "#b20000" }}
        >
          {record.error.message}
        </p>
      )}
      {closeLoan.error && (
        <p
          role="alert"
          data-testid="record-repayment-close-error"
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: "#b20000" }}
        >
          {closeLoan.error.message}
        </p>
      )}
      <div className="flex items-center justify-end gap-[12px]">
        <Link
          to="/loans/$id"
          params={{ id }}
          className="flex h-[48px] items-center rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[24px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] no-underline"
        >
          Cancel
        </Link>
        {view.showCloseLoan && (
          <button
            type="button"
            data-testid="record-repayment-close-submit"
            disabled={view.closureReason == null || closeLoan.isPending}
            onClick={onCloseLoan}
            className="h-[48px] rounded-[4px] border border-solid px-[24px] font-[family-name:var(--font-body)] text-[16px] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: LINE_COLOR, color: "#262524" }}
          >
            {closeLoan.isPending
              ? closeStageLabel(closeLoan.stage)
              : "Move loan to closed"}
          </button>
        )}
        <button
          type="button"
          data-testid="record-repayment-submit"
          disabled={view.recordPaymentInput == null || record.isPending}
          onClick={onRecord}
          className="h-[48px] rounded-[4px] px-[24px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: BRAND }}
        >
          {record.isPending
            ? recordStageLabel(record.stage)
            : "Record repayment"}
        </button>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/loans/$id_/record-repayment")({
  component: RecordRepayment,
});

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRecordCoupon, type WaterfallRow } from "./-record-coupon";
import { useRecordPayment } from "@/api/useRecordPayment";

/**
 * Record Coupon full-page route (issue #882, Figma node `4116-11452`) — the
 * destination opened by clicking the existing "Record coupon" other-action
 * on the loan-detail page (`loans.$id.tsx`, available in any post-Disbursing
 * status, #867).
 *
 * A full-screen page, not a modal, so it lives at its own route rather than
 * inside `loans.$id.tsx`. It is registered as a NON-nested child of the
 * `/loans` layout (`loans.tsx`'s `<Outlet/>`) via the `$id_` trailing-
 * underscore file-name escape — `loans.$id.tsx` is a leaf page with no
 * `<Outlet/>` of its own, so a plain `loans.$id.record-coupon.tsx` would try
 * to nest under it and fail to register (same class of issue `loans.tsx`'s
 * doc comment describes for `/loans/$id` itself).
 *
 * ## Scope (read/UI only — see `-record-coupon.ts`'s module doc)
 * Previews the payment waterfall for a trustee-entered offtaker coupon via
 * the already-wired `useLoanWaterfall`. Does NOT perform the on-chain
 * `record_payment` write — no submit action exists on this page yet.
 *
 * ## Chips (never-fabricate)
 * Only the static "Your key · no cash moves" copy chip renders. The Figma's
 * "Recorded · 31 Mar" / "Minted · 2 Apr" progress chips are omitted entirely —
 * no backend source ever marks a coupon "recorded"/"minted" in this session
 * (the write doesn't exist yet), so they would be fabricated.
 *
 * ## Suppressed "Next stage: principal repayment" button
 * Per the issue's explicit scope note, the Figma's button is never rendered.
 * In its place, `view.isTerminal` gates a plain text hint — ONLY in the
 * terminal case where this coupon fully amortises the outstanding senior
 * principal (`isTerminalRepayment` in `-record-coupon.ts`). Every other
 * coupon (the common interest-only case) shows no principal-repayment copy
 * at all.
 *
 * Per `docs/FRONTEND.md` rule 2, this `.tsx` is JSX/styling only; all data
 * wiring + value→display mapping lives in the colocated `-record-coupon.ts`
 * view-model hook (mirrors `origination.$id.tsx` / `-origination-detail.ts`).
 */

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
const INK = "var(--color-pipeline-ink)";
const INK_MUTED = "rgba(56,55,53,0.6)";
const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";
const BRAND = "var(--color-pipeline-brand)";

/** Progress copy for each `record_payment` stage, shown on the confirm button. */
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

// Muted surface fill behind the input boxes and the waterfall step badges —
// the exact Figma fill (node `4116-11295`), a light warm grey distinct from
// the ink-based `--color-pipeline-surface-muted` token.
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
}: {
  row: WaterfallRow;
  /** 1-based step number shown in the row's circular badge (Figma node `4116-11295`). */
  step: number;
  isLast: boolean;
}) {
  return (
    <div
      data-testid="record-coupon-waterfall-row"
      className="flex items-start gap-[14px] py-[12px]"
      style={{
        ...(isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }),
        // Disabled = the always-$0 senior-principal row on an interest-only
        // coupon (principal stays deployed, #882) — greyed out, not applied.
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
      <span className="shrink-0 text-right font-[family-name:var(--font-body)] text-[16px] font-semibold leading-[22.4px] text-[#262524]">
        {row.value}
      </span>
    </div>
  );
}

function RecordCoupon() {
  const { id } = Route.useParams();
  const view = useRecordCoupon(id);
  const navigate = useNavigate();
  const record = useRecordPayment();

  const onRecord = () => {
    if (view.recordPaymentInput == null) return;
    record.reset();
    void record
      .mutateAsync({ loanId: Number(id), repayment: view.recordPaymentInput })
      .then(() => navigate({ to: "/loans/$id", params: { id } }))
      .catch(() => {
        // Error surfaces inline via `record.error`; stay on the page to retry.
      });
  };

  if (view.state === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[24px] px-[56px] pt-[39px] pb-[80px]">
        <div
          data-testid="record-coupon-loading"
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
          data-testid="record-coupon-error"
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
          data-testid="record-coupon-not-found"
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
          Record Coupon — Interest Only
        </h1>
        <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
          <span
            data-testid="record-coupon-key-chip"
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

      <div
        data-testid="record-coupon-info-banner"
        className="rounded-[4px] border border-solid px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
        style={{
          backgroundColor: "rgba(191,189,187,0.12)",
          borderColor: LINE_COLOR,
          color: INK,
        }}
      >
        A scheduled coupon is a{" "}
        <span className="font-semibold">recordPayment with zero principal</span>{" "}
        — the same waterfall, senior principal stays deployed. Deferred interest
        (all-zero components) is also allowed.
      </div>

      <div className="flex w-full gap-[20px]">
        <div
          data-testid="record-coupon-left-card"
          className="flex flex-1 flex-col gap-[16px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white p-[26px]"
        >
          <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
            {view.originator}
          </h2>
          <div>
            <TermRow label="Coupon period" value={view.couponPeriod} />
            <TermRow
              label="Senior outstanding — unchanged"
              value={view.seniorOutstanding}
            />
            <TermRow
              label={view.thirdRowLabel}
              value={view.thirdRowValue}
              isLast
            />
          </div>
          {/* Editable field → white fill (with a focus-within border), so it
              reads as active and NOT like the disabled/muted date field below. */}
          <label
            className={`${FIELD_BOX} bg-white focus-within:border-[rgba(56,55,53,0.45)]`}
          >
            <span className={FIELD_LABEL_CLASS} style={{ color: INK_MUTED }}>
              Offtaker payment received (USD, Trust account)
            </span>
            <input
              type="number"
              inputMode="decimal"
              data-testid="record-coupon-amount"
              value={view.amountInput}
              onChange={(e) => view.onAmountChange(e.target.value)}
              placeholder="e.g. 45000"
              className={FIELD_INPUT_CLASS}
            />
          </label>
          <label className={FIELD_BOX} style={{ backgroundColor: FIELD_FILL }}>
            <span className={FIELD_LABEL_CLASS} style={{ color: INK_MUTED }}>
              Date received
            </span>
            <input
              type="date"
              data-testid="record-coupon-date"
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
          data-testid="record-coupon-right-card"
          className="flex flex-1 flex-col gap-[16px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white p-[26px]"
        >
          <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
            Waterfall Breakdown — computed
          </h2>
          {view.waterfall.rows.length === 0 ? (
            <p
              data-testid="record-coupon-waterfall-empty"
              className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
              style={{ color: INK_MUTED }}
            >
              Enter a coupon amount to preview the waterfall.
            </p>
          ) : (
            <div>
              {view.waterfall.rows.map((row, i) => (
                <WaterfallRowView
                  key={row.label}
                  row={row}
                  step={i + 1}
                  isLast={i === view.waterfall.rows.length - 1}
                />
              ))}
            </div>
          )}
          {view.waterfall.errorMessage && (
            <p
              role="alert"
              data-testid="record-coupon-waterfall-error"
              className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
              style={{ color: "#b20000" }}
            >
              {view.waterfall.errorMessage}
            </p>
          )}
          {view.summaryText && (
            <div
              data-testid="record-coupon-summary"
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
          {/* Terminal-close hint ONLY — the Figma's "Next stage: principal
              repayment →" button is suppressed everywhere else (issue #882
              explicit scope note). */}
          {view.isTerminal && (
            <p
              data-testid="record-coupon-terminal-hint"
              className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
              style={{ color: INK_MUTED }}
            >
              This coupon fully repays senior principal — next stage: principal
              repayment closes the loan.
            </p>
          )}

          {/* Confirm — trustee-wallet-signed on-chain `record_payment` (#882).
              Pinned to the bottom of the right card (`mt-auto`) per Figma node
              `4116-11295` — stays anchored even before an amount is entered. */}
          <div className="mt-auto flex flex-col gap-[12px] pt-[16px]">
            {record.error && (
              <p
                role="alert"
                data-testid="record-coupon-record-error"
                className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
                style={{ color: "#b20000" }}
              >
                {record.error.message}
              </p>
            )}
            <button
              type="button"
              data-testid="record-coupon-submit"
              disabled={view.recordPaymentInput == null || record.isPending}
              onClick={onRecord}
              className="flex h-[48px] w-full items-center justify-center rounded-[4px] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {record.isPending
                ? recordStageLabel(record.stage)
                : "Record on the ledger"}
            </button>
            <p
              className="text-center font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
              style={{ color: INK_MUTED }}
            >
              recordPayment is pure accounting — increments the per-loan
              counters, emits PaymentRecorded, moves no USDC.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/loans/$id_/record-coupon")({
  component: RecordCoupon,
});

/**
 * View-model + data wiring for the Trustee Record Repayment — Principal
 * full-page route (`loans.$id_.record-repayment.tsx`) — the
 * principal-repayment sibling of the Record Coupon flow (`-record-coupon.ts`).
 * Per `docs/FRONTEND.md` Code structure rule 2 the `.tsx` route is
 * JSX/styling only; this hook owns the live fetches, the amount/date input
 * state, and the value→display mapping.
 *
 * spec: docs/frontend/trustee-flows.md#cash-movement--lifecycle-actions
 * (scope, key difference from Record Coupon, scale handling, close-loan
 * gating).
 */
import { useEffect, useMemo, useState } from "react";
import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import type { Epoch } from "@/api/useLoanFinancials";
import { useLoanWaterfall } from "@/api/useLoanWaterfall";
import type { RepaymentInput } from "@/api/useRecordPayment";
import { formatFullUsd, formatUsdInputValue } from "@/utils/formatUsd";
import { formatEpochDate } from "@/utils/formatDate";
import {
  parsePositiveUsdInput,
  sacBaseUnitsToUsdDecimal,
  usdInputToSacBaseUnits,
} from "@/utils/stellarSacUnits";
import { mapWaterfallError, toUserError } from "@/utils/userError";
import type { UserFacingError } from "@/utils/userError";

// ── Pure helpers (exported for unit tests) ──────────────────────────────────

/** Today, `YYYY-MM-DD` — the "Date received" input's default value. */
export function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parses the "Offtaker payment received" USD text input into a positive
 * dollar amount. Empty/zero/negative/non-numeric input → `null` (keeps the
 * waterfall query disabled and every downstream derived value at its neutral
 * "—"/unset state).
 */
export function parseUsdInput(input: string): number | null {
  return parsePositiveUsdInput(input);
}

/**
 * Converts the entered USD amount into the raw 7-decimal SAC integer string the
 * `/waterfall` endpoint expects. Invalid/empty/zero input returns `"0"` so
 * `useLoanWaterfall` remains disabled.
 */
export function usdToBaseUnits(input: string | null): string {
  return usdInputToSacBaseUnits(input) ?? "0";
}

/** Divides a raw 7-decimal SAC waterfall amount into display USD. */
function baseUnitsToUsd(baseUnits: string | undefined): number | null {
  const display = sacBaseUnitsToUsdDecimal(baseUnits);
  if (display == null) return null;
  const n = Number(display);
  return Number.isFinite(n) ? n : null;
}

/** Sums whole-base-unit integer strings via `BigInt` — exact, no float drift. */
function sumBaseUnits(values: (string | undefined)[]): string | null {
  if (values.some((v) => v == null)) return null;
  return values.reduce((acc, v) => acc + BigInt(v!), 0n).toString();
}

/** `$X` (whole dollars, per `formatFullUsd`) for a USD number; `—` for `null`. */
function usdFull(usd: number | null): string {
  return usd == null ? "—" : formatFullUsd(usd.toString());
}

// spec: docs/frontend/trustee-flows.md#record-repayment--principal-884--key-difference-from-record-coupon.
export function buildRepaymentInput(
  amountBaseUnits: string,
  waterfall:
    | {
        senior_principal_returned: string;
        senior_coupon_net: string;
        management_fee: string;
        performance_fee: string;
        oet_allocation: string;
      }
    | undefined,
): RepaymentInput | null {
  if (waterfall == null || amountBaseUnits === "0") return null;
  const carveouts =
    BigInt(waterfall.senior_principal_returned) +
    BigInt(waterfall.senior_coupon_net) +
    BigInt(waterfall.management_fee) +
    BigInt(waterfall.performance_fee) +
    BigInt(waterfall.oet_allocation);
  const residual = BigInt(amountBaseUnits) - carveouts;
  return {
    offtaker_received: amountBaseUnits,
    senior_principal_repaid: waterfall.senior_principal_returned,
    senior_interest: waterfall.senior_coupon_net,
    equity_distributed: (residual > 0n ? residual : 0n).toString(),
    mgmt_fee: waterfall.management_fee,
    perf_fee: waterfall.performance_fee,
    oet_alloc: waterfall.oet_allocation,
  };
}

// Displayed as served, no rescaling (issue #906).
function parseServedUsd(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

// e.g. "31 Mar 2026 → 24 Jun 2026 · 85 days" — same computation as
// `computeCouponPeriod`, renamed for this page's "Final period" row.
export function computeFinalPeriod(epoch: Epoch | null): {
  label: string;
  days: number | null;
} {
  if (epoch == null) return { label: "—", days: null };
  const start = new Date(epoch.start_date);
  const maturity = new Date(epoch.maturity_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(maturity.getTime())) {
    return { label: "—", days: null };
  }
  const days = Math.round((maturity.getTime() - start.getTime()) / 86_400_000);
  return {
    label: `${formatEpochDate(epoch.start_date)} → ${formatEpochDate(epoch.maturity_date)} · ${days} days`,
    days,
  };
}

// Mirrors -record-coupon.ts's isTerminalRepayment. spec:
// docs/frontend/trustee-flows.md#close-loan-gating-884-resolved-open-questions-13.
export function isTerminalRepayment(
  outstandingSeniorUsd: number | null,
  enteredUsd: number | null,
  seniorPrincipalReturnedUsd: number | null,
): boolean {
  if (
    outstandingSeniorUsd == null ||
    enteredUsd == null ||
    seniorPrincipalReturnedUsd == null ||
    outstandingSeniorUsd <= 0
  ) {
    return false;
  }
  const toCents = (n: number) => Math.round(n * 100);
  return (
    enteredUsd >= outstandingSeniorUsd &&
    toCents(seniorPrincipalReturnedUsd) === toCents(outstandingSeniorUsd)
  );
}

// spec: docs/frontend/trustee-flows.md#close-loan-gating-884-resolved-open-questions-13.
export function closureReason(
  nowSeconds: number,
  maturitySeconds: number,
): "ScheduledMaturity" | "EarlyRepayment" {
  return nowSeconds >= maturitySeconds ? "ScheduledMaturity" : "EarlyRepayment";
}

// ── View types ──────────────────────────────────────────────────────────────

export interface WaterfallRow {
  label: string;
  value: string;
  /** Muted sub-line under the row (e.g. on-ramp / mint notes); `null` when none. */
  sub: string | null;
  /** Rendered greyed-out (opacity 0.5) to match the Figma — used for the
   *  "Originator residual" leg (stays USD off-chain, not on-ramped/minted). */
  disabled?: boolean;
}

export interface RecordRepaymentView {
  state: "loading" | "error" | "not-found" | "ready";
  errorMessage: string | null;
  errorDetails: string | null;
  originator: string;
  backLabel: string;
  commodity: string;
  finalPeriod: string;
  seniorOutstandingBefore: string;
  offtakerOwed: string;
  amountInput: string;
  onAmountChange: (value: string) => void;
  /** Fixed to today (read-only) — the repayment is always recorded as of today (#916). */
  dateInput: string;
  waterfall: {
    /** `true` once a positive amount has been entered and the preview has resolved. */
    ready: boolean;
    /** `true` while a recalculation for the entered amount is pending (#1049). */
    isCalculating: boolean;
    errorMessage: string | null;
    errorDetails: string | null;
    rows: WaterfallRow[];
  };
  /** `"Components sum to received $<amount>"` — `null` until a positive amount is entered and the preview resolves. */
  summaryText: string | null;
  /**
   * The on-chain `RepaymentData` for `record_payment` (base-unit strings);
   * `null` until a positive amount is entered and the preview resolves. The
   * page passes this to `useRecordPayment` on confirm (#884).
   */
  recordPaymentInput: RepaymentInput | null;
  /**
   * `true` once closing is applicable — the terminal entered amount would fully
   * repay the loan OR the loan-book's outstanding senior is already `0`. Gates
   * whether the Close-loan action can ever enable (it still stays disabled until
   * the payment is actually complete — see `alreadyRepaid` / `record.isSuccess`).
   */
  showCloseLoan: boolean;
  /**
   * `true` when the loan-book's outstanding senior is already `0` on load — the
   * final payment is already complete (e.g. the trustee reloads after recording
   * it), so the Close-loan action may enable without recording again.
   */
  alreadyRepaid: boolean;
  /** The `ClosureReason` to pass to `useCloseLoan`; `null` while the loan's maturity is unknown. */
  closureReason: "ScheduledMaturity" | "EarlyRepayment" | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires the loan-book row (identity + outstanding senior + maturity), the
 * loan's financials (final period + offtaker outstanding), and the waterfall
 * preview for the trustee-entered amount/date, for `loanId`.
 */
export function useRecordRepayment(loanId: string): RecordRepaymentView {
  const loanBook = useLoanBook();
  const financials = useLoanFinancials(loanId);

  const [amountInput, setAmountInput] = useState("");
  // Date is fixed to today and not editable (#916) — no calendar/date picker.
  const dateInput = todayDateInput();

  // Debounce the amount that drives the waterfall query (the input field itself
  // stays fully responsive) so holding/typing doesn't fire a `/waterfall`
  // request per keystroke (mirrors #882).
  const [debouncedAmount, setDebouncedAmount] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAmount(amountInput), 400);
    return () => clearTimeout(timer);
  }, [amountInput]);

  const enteredUsd = parseUsdInput(debouncedAmount);
  const amountBaseUnits = usdToBaseUnits(debouncedAmount);
  const asOfSeconds = useMemo(() => {
    if (!dateInput) return Math.floor(Date.now() / 1000);
    const parsed = Math.floor(
      new Date(`${dateInput}T00:00:00Z`).getTime() / 1000,
    );
    return Number.isFinite(parsed) ? parsed : Math.floor(Date.now() / 1000);
  }, [dateInput]);

  const waterfall = useLoanWaterfall(loanId, amountBaseUnits, asOfSeconds);

  const entry = loanBook.data?.loans.find((l) => l.loan_id === loanId);

  const state: RecordRepaymentView["state"] = loanBook.isLoading
    ? "loading"
    : loanBook.error
      ? "error"
      : entry == null
        ? "not-found"
        : "ready";

  const outstandingSeniorUsd = parseServedUsd(entry?.senior_outstanding);
  const offtakerOutstandingUsd = parseServedUsd(
    financials.data?.offtaker_outstanding,
  );

  // Set the amount to the full remaining owed once financials load — a
  // principal repayment always pays it ALL (the input is read-only on the page,
  // no partial principal repayments). One-shot so a later refetch never
  // clobbers it; the field is disabled, so the trustee can't edit it down.
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (
      !prefilled &&
      amountInput === "" &&
      offtakerOutstandingUsd != null &&
      offtakerOutstandingUsd > 0
    ) {
      setAmountInput(formatUsdInputValue(String(offtakerOutstandingUsd)));
      setPrefilled(true);
    }
  }, [prefilled, amountInput, offtakerOutstandingUsd]);

  const finalPeriod = computeFinalPeriod(financials.data?.epoch ?? null);

  const seniorPrincipalReturnedUsd = baseUnitsToUsd(
    waterfall.data?.senior_principal_returned,
  );
  const managementFeeUsd = baseUnitsToUsd(waterfall.data?.management_fee);
  const performanceFeeUsd = baseUnitsToUsd(waterfall.data?.performance_fee);
  const oetAllocationUsd = baseUnitsToUsd(waterfall.data?.oet_allocation);
  const netSeniorCouponUsd = baseUnitsToUsd(waterfall.data?.senior_coupon_net);
  const grossInterestBase = waterfall.data
    ? sumBaseUnits([
        waterfall.data.senior_coupon_net,
        waterfall.data.management_fee,
        waterfall.data.performance_fee,
      ])
    : null;
  const grossInterestUsd = baseUnitsToUsd(grossInterestBase ?? undefined);

  const recordPaymentInput = buildRepaymentInput(
    amountBaseUnits,
    waterfall.data,
  );
  const equityUsd = recordPaymentInput
    ? baseUnitsToUsd(recordPaymentInput.equity_distributed)
    : null;

  const enteredUsdLive = parseUsdInput(amountInput);
  const isCalculating =
    enteredUsdLive != null &&
    (amountInput !== debouncedAmount ||
      (waterfall.data == null && waterfall.error == null));

  const rows: WaterfallRow[] =
    waterfall.data != null || enteredUsdLive != null
      ? [
          {
            // Principal repayment: the real, waterfall-served figure (unlike
            // #882's always-$0 forced coupon row) — never disabled.
            label: "Senior principal returned",
            value: usdFull(seniorPrincipalReturnedUsd),
            sub: "On-ramped, no mint (rebalances backing)",
          },
          {
            label: "Gross interest (final period)",
            value: usdFull(grossInterestUsd),
            sub: null,
          },
          {
            label: "Management fee",
            value: usdFull(managementFeeUsd),
            sub: null,
          },
          {
            label: "Performance fee",
            value: usdFull(performanceFeeUsd),
            sub: null,
          },
          {
            label: "OET allocation",
            value: usdFull(oetAllocationUsd),
            sub: null,
          },
          {
            label: "Net senior coupon → vault",
            value: usdFull(netSeniorCouponUsd),
            sub: "Mints to sPLUSD, lifts NAV",
          },
          {
            // The offtaker-received residual after principal + interest + fees.
            // Dimmed to match the Figma (it stays USD off-chain — not on-ramped
            // / not minted), like the other non-vault leg.
            label: "Originator residual",
            value: usdFull(equityUsd),
            sub: "Stays USD off-chain, not on-ramped",
            disabled: true,
          },
        ]
      : [];

  const summaryText =
    enteredUsd != null && waterfall.data != null
      ? `Components sum to received ${usdFull(enteredUsd)}`
      : null;

  const isTerminal =
    waterfall.data != null &&
    isTerminalRepayment(
      outstandingSeniorUsd,
      enteredUsd,
      seniorPrincipalReturnedUsd,
    );

  const alreadyRepaid =
    outstandingSeniorUsd != null && outstandingSeniorUsd <= 0;
  const showCloseLoan = isTerminal || alreadyRepaid;

  const maturity = entry?.maturity ?? null;
  const reason =
    maturity == null
      ? null
      : closureReason(Math.floor(Date.now() / 1000), maturity);

  const loanBookError: UserFacingError | null = loanBook.error
    ? toUserError(loanBook.error, "Failed to load the loan.")
    : null;
  const waterfallError = mapWaterfallError(waterfall.error);

  return {
    state,
    errorMessage: loanBookError?.message ?? null,
    errorDetails: loanBookError?.details ?? null,
    originator: entry?.originator ?? "—",
    backLabel:
      entry != null ? `‹ ${entry.originator} · ${entry.commodity}` : "‹ Loan",
    commodity: entry?.commodity ?? "—",
    finalPeriod: finalPeriod.label,
    seniorOutstandingBefore: usdFull(outstandingSeniorUsd),
    offtakerOwed: usdFull(offtakerOutstandingUsd),
    amountInput,
    onAmountChange: setAmountInput,
    dateInput,
    waterfall: {
      ready: waterfall.data != null,
      isCalculating,
      errorMessage: waterfallError?.message ?? null,
      errorDetails: waterfallError?.details ?? null,
      rows,
    },
    summaryText,
    recordPaymentInput,
    showCloseLoan,
    alreadyRepaid,
    closureReason: reason,
  };
}

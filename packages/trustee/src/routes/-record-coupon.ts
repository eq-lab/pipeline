/**
 * View-model + data wiring for the Trustee Record Coupon full-page route
 * (`loans.$id_.record-coupon.tsx`). Per `docs/FRONTEND.md` Code structure
 * rule 2 the `.tsx` route is JSX/styling only; this hook owns the live
 * fetches, the amount/date input state, and the value→display mapping
 * (mirroring `-useLoanDetail.ts`'s split).
 *
 * spec: docs/frontend/trustee-flows.md#cash-movement--lifecycle-actions
 * (scope, scale handling, terminal-close detection).
 */
import { useEffect, useMemo, useState } from "react";
import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import type { Epoch } from "@/api/useLoanFinancials";
import { useLoanWaterfall } from "@/api/useLoanWaterfall";
import type { RepaymentInput } from "@/api/useRecordPayment";
import { ApiError } from "@/api/client";
import { formatBpsRate, formatFullUsd } from "@/utils/formatUsd";
import { formatEpochDate } from "@/utils/formatDate";
import {
  parsePositiveUsdInput,
  sacBaseUnitsToUsdDecimal,
  usdInputToSacBaseUnits,
} from "@/utils/stellarSacUnits";

// ── Pure helpers (exported for unit tests) ──────────────────────────────────

/** Today, `YYYY-MM-DD` — the "Date received" input's default value. */
export function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parses the "Coupon received" USD text input into a positive dollar amount.
 * Empty/zero/negative/non-numeric input → `null` (keeps the waterfall query
 * disabled and every downstream derived value at its neutral "—"/unset state).
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

// spec: docs/frontend/trustee-flows.md#waterfall-error-mapping-916.
export function mapWaterfallError(error: Error | null): string | null {
  if (error == null) return null;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return "This amount is too high for this loan. Enter a smaller amount.";
  }
  return "Couldn't preview this payment. Please try again.";
}

// spec: docs/frontend/trustee-flows.md#record-coupon--interest-only-context-dependent-third-row.
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
  // Interest-only: no principal is repaid, so equity absorbs the amount left
  // after the interest + fee carve-outs.
  const carveouts =
    BigInt(waterfall.senior_coupon_net) +
    BigInt(waterfall.management_fee) +
    BigInt(waterfall.performance_fee) +
    BigInt(waterfall.oet_allocation);
  const residual = BigInt(amountBaseUnits) - carveouts;
  return {
    offtaker_received: amountBaseUnits,
    senior_principal_repaid: "0",
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

// e.g. "2 Jan 2026 → 31 Mar 2026 · 88 days". "—"/null when no epoch is on record.
export function computeCouponPeriod(epoch: Epoch | null): {
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

// A client-side projection, reference-only. spec:
// docs/frontend/trustee-flows.md#record-coupon--interest-only-context-dependent-third-row.
export function computeScheduledCoupon(
  apyBps: number | null | undefined,
  outstandingSeniorUsd: number | null,
  days: number | null,
): number | null {
  if (
    apyBps == null ||
    !Number.isFinite(apyBps) ||
    outstandingSeniorUsd == null ||
    days == null
  ) {
    return null;
  }
  return (apyBps / 10_000) * outstandingSeniorUsd * (days / 365);
}

/** Days before an epoch's maturity within which its coupon counts as "upcoming". */
export const DUE_SOON_DAYS = 7;

// spec: docs/frontend/trustee-flows.md#record-coupon--interest-only-context-dependent-third-row.
export function hasCouponDue(
  maturityDate: string | null | undefined,
  nowMs: number,
  dueSoonDays: number = DUE_SOON_DAYS,
): boolean {
  if (maturityDate == null) return false;
  const maturity = new Date(maturityDate);
  if (Number.isNaN(maturity.getTime())) return false;
  return nowMs >= maturity.getTime() - dueSoonDays * 86_400_000;
}

// spec: docs/frontend/trustee-flows.md#record-coupon--interest-only-context-dependent-third-row.
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

// ── View types ──────────────────────────────────────────────────────────────

export interface WaterfallRow {
  label: string;
  value: string;
  /** Muted sub-line under the row (e.g. the interest-only / minted-to-vault notes); `null` when none. */
  sub: string | null;
  /** Rendered greyed-out / inapplicable (the always-$0 senior-principal row on a coupon). */
  disabled?: boolean;
}

export interface RecordCouponView {
  state: "loading" | "error" | "not-found" | "ready";
  errorMessage: string | null;
  originator: string;
  backLabel: string;
  couponPeriod: string;
  seniorOutstanding: string;
  /**
   * `true` when the left card's third row shows the **"Scheduled coupon"** line
   * — a payment is due (upcoming/past due) OR the loan isn't cleanly performing.
   * `false` shows **"Offtaker still owed after coupon"** (a simply-performing
   * loan with nothing due).
   */
  showScheduledCoupon: boolean;
  /** Third left-card row label — the scheduled-coupon line or "Offtaker still owed after coupon". */
  thirdRowLabel: string;
  /** Third left-card row value — the projected coupon (APY × outstanding × days/365) or the remaining offtaker owed. */
  thirdRowValue: string;
  amountInput: string;
  onAmountChange: (value: string) => void;
  /** Fixed to today (read-only) — the coupon is always recorded as of today (#916). */
  dateInput: string;
  waterfall: {
    /** `true` once a positive amount has been entered and the preview has resolved. */
    ready: boolean;
    errorMessage: string | null;
    rows: WaterfallRow[];
  };
  /** `"Components sum to received $<amount>"` — `null` until a positive amount is entered and the preview resolves. */
  summaryText: string | null;
  isTerminal: boolean;
  /**
   * The on-chain `RepaymentData` for `record_payment` (base-unit strings);
   * `null` until a positive amount is entered and the preview resolves. The page
   * passes this to `useRecordPayment` on confirm (#882).
   */
  recordPaymentInput: RepaymentInput | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires the loan-book row (identity + outstanding senior), the loan's
 * financials (coupon period + offtaker outstanding), and the waterfall
 * preview for the trustee-entered amount/date, for `loanId`.
 */
export function useRecordCoupon(loanId: string): RecordCouponView {
  const loanBook = useLoanBook();
  const financials = useLoanFinancials(loanId);

  const [amountInput, setAmountInput] = useState("");
  // Date is fixed to today and not editable (#916) — no calendar/date picker.
  const dateInput = todayDateInput();

  // Debounce the amount that drives the waterfall query (the input field itself
  // stays fully responsive) so holding/typing doesn't fire a `/waterfall`
  // request per keystroke (#882).
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

  const state: RecordCouponView["state"] = loanBook.isLoading
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
  // Subtract the amount as it's typed (the LIVE input, not the debounced value
  // that throttles the waterfall query) so "still owed after coupon" tracks the
  // input in real time.
  const enteredUsdLive = parseUsdInput(amountInput);
  const offtakerOwedAfterUsd =
    offtakerOutstandingUsd == null
      ? null
      : Math.max(0, offtakerOutstandingUsd - (enteredUsdLive ?? 0));

  const couponPeriod = computeCouponPeriod(financials.data?.epoch ?? null);

  const apyBps = financials.data?.epoch?.current_apy_bps ?? null;
  const scheduledCouponUsd = computeScheduledCoupon(
    apyBps,
    outstandingSeniorUsd,
    couponPeriod.days,
  );
  const scheduledCouponLabel =
    apyBps == null
      ? "Scheduled coupon"
      : `Scheduled coupon (${formatBpsRate(apyBps)} p.a.)`;

  // Third left-card row: surface the "Scheduled coupon" when a payment is due
  // (upcoming or past due) OR the loan isn't cleanly performing; a simply-
  // performing loan with nothing due shows "Offtaker still owed after coupon".
  const isPerforming = (entry?.status ?? null) === "Performing";
  const couponDue = hasCouponDue(
    financials.data?.epoch?.maturity_date,
    Date.now(),
  );
  const showScheduledCoupon = couponDue || !isPerforming;
  const thirdRowLabel = showScheduledCoupon
    ? scheduledCouponLabel
    : "Offtaker still owed after coupon";
  const thirdRowValue = showScheduledCoupon
    ? usdFull(scheduledCouponUsd)
    : usdFull(offtakerOwedAfterUsd);

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

  const rows: WaterfallRow[] = waterfall.data
    ? [
        {
          // Interest-only coupon: principal never returns here (it's a zero-
          // principal recordPayment), so this is always $0 and disabled — the
          // waterfall's own principal-first figure is not applied (#882).
          label: "Senior principal returned",
          value: usdFull(0),
          sub: "Interest-only coupon — principal stays deployed",
          disabled: true,
        },
        {
          label: `Gross interest (${couponPeriod.days ?? "—"} / 365 days)`,
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
          sub: "Mints to sPLUSD once the on-ramp lands",
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

  return {
    state,
    errorMessage: loanBook.error?.message ?? null,
    originator: entry?.originator ?? "—",
    backLabel:
      entry != null ? `‹ ${entry.originator} · ${entry.commodity}` : "‹ Loan",
    couponPeriod: couponPeriod.label,
    seniorOutstanding: usdFull(outstandingSeniorUsd),
    showScheduledCoupon,
    thirdRowLabel,
    thirdRowValue,
    amountInput,
    onAmountChange: setAmountInput,
    dateInput,
    waterfall: {
      ready: waterfall.data != null,
      errorMessage: mapWaterfallError(waterfall.error),
      rows,
    },
    summaryText,
    isTerminal,
    recordPaymentInput: buildRepaymentInput(amountBaseUnits, waterfall.data),
  };
}

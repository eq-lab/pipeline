/**
 * View-model + data wiring for the Trustee **Record Coupon** full-page route
 * (`loans.$id_.record-coupon.tsx`, issue #882, Figma node `4116-11452`). Per
 * `docs/FRONTEND.md` Code structure rule 2 the `.tsx` route is JSX/styling
 * only; this hook owns the live fetches, the amount/date input state, and the
 * value→display mapping (mirroring `-useLoanDetail.ts`'s split).
 *
 * ## Scope (issue #882 — read/UI only)
 * This page previews the payment waterfall for a trustee-entered offtaker
 * coupon via `useLoanWaterfall` (`GET /v1/loan-book/{loan_id}/waterfall`,
 * already wired). It does NOT perform the on-chain `record_payment` write —
 * that mutation (`useRecordPayment`) is deferred to a follow-up issue, so
 * there is no submit/confirm action here, only the live preview.
 *
 * ## Scale handling (critical — verified against `-useLoanDetail.ts` /
 * `useLoanWaterfall.ts` before wiring, per the issue's explicit instruction)
 *   - The `/waterfall` `amount` param and all response fields
 *     (`senior_principal_returned`, `senior_coupon_net`, `management_fee`,
 *     `performance_fee`, `oet_allocation`) are **raw base units at 7-decimal
 *     USDC (Stellar SAC) scale**. `usdToBaseUnits` multiplies the entered USD
 *     amount by 10^7 before calling the endpoint; `baseUnitsToUsd` divides
 *     backend response fields by 10^7 for display. The `recordPayment` payload
 *     uses backend raw fields unchanged.
 *   - `senior_outstanding` (`useLoanBook`) / `offtaker_outstanding`
 *     (`useLoanFinancials`) are displayed **exactly as the backend serves
 *     them** — no client-side rescaling (issue #906; the former ×1000
 *     `scaleRegistryAmount` workaround has been removed).
 *   - The left card's third row is **context-dependent** (`hasCouponDue`): a
 *     simply-performing loan with no upcoming/past-due payment shows the
 *     backend-served **"Offtaker still owed after coupon"** (`offtaker_
 *     outstanding − entered`); otherwise it shows the **"Scheduled coupon"** —
 *     a **client-side projection** (`current_apy_bps × senior_outstanding ×
 *     (days / 365)`, `computeScheduledCoupon`; the backend serves no scheduled-
 *     coupon figure), shown for reference only and never recorded on the ledger.
 *   - `Gross interest` is derived as `senior_coupon_net + management_fee +
 *     performance_fee` (summed in base units via `BigInt` — no float drift —
 *     then converted once to USD) — the interest before the fee carve-outs,
 *     not a separately-served field.
 *   - The green summary's `"Components sum to received $<amount>"` prints the
 *     ENTERED USD amount, not a re-derived sum of the five components (the
 *     waterfall has no equity field, so the five components alone do not sum
 *     to the offtaker amount — see issue #882's on-chain open question).
 *
 * ## Terminal-close detection (issue #882 explicit scope note)
 * The Figma's "Next stage: principal repayment →" button is suppressed
 * everywhere EXCEPT the terminal case — when this coupon fully amortises the
 * outstanding senior principal (`isTerminalRepayment`): the entered amount
 * covers (≥) the loan's outstanding senior AND the waterfall's own
 * `senior_principal_returned` equals it exactly (to the cent, guarding float
 * drift from the two independent unit conversions). Otherwise no hint renders
 * at all — this is an interest-only coupon page by default.
 */
import { useEffect, useMemo, useState } from "react";
import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import type { Epoch } from "@/api/useLoanFinancials";
import { useLoanWaterfall } from "@/api/useLoanWaterfall";
import type { RepaymentInput } from "@/api/useRecordPayment";
import { formatBpsRate, formatFullUsd } from "@/utils/formatUsd";
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

/**
 * Builds the on-chain `RepaymentData` (issue #882) from the waterfall preview +
 * the entered offtaker amount (raw base-unit integer strings — passed through
 * unscaled to `record_payment`).
 *
 * This is the **interest-only coupon** flow (a `recordPayment` with **zero
 * principal** — the design's info banner): `senior_principal_repaid` is always
 * `0` (principal stays deployed), regardless of the waterfall's own
 * `senior_principal_returned` (which is a principal-first `min(amount,
 * outstanding)` figure, irrelevant to a coupon). The interest + fee carve-outs
 * map 1:1; `equity_distributed` is the **residual** after interest + fees so the
 * six components sum exactly to `offtaker_received` (clamped at 0 — never
 * negative). `null` until a positive amount is entered and the preview resolves.
 * Exported for unit testing.
 */
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

/**
 * Parses a backend-served base-6 decimal amount to a plain USD number, as-is —
 * no client-side rescaling (issue #906). `null` for anything missing/
 * unparseable — never fabricated.
 */
function parseServedUsd(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The coupon-period display (`"2 Jan 2026 → 31 Mar 2026 · 88 days"`) derived from the
 * loan's current epoch (`start_date` → `maturity_date`). `—` / `null` days
 * when no epoch is on record (never fabricated).
 */
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

/**
 * The scheduled coupon for the current period — the interest the loan is
 * expected to pay this coupon: `senior APY × outstanding senior × (days /
 * 365)`. A **client-side projection** shown as a reference row only (the
 * backend serves no scheduled-coupon figure, and this is never recorded on the
 * ledger). `null` whenever the rate, outstanding senior, or period length is
 * unknown — never fabricated.
 */
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

/**
 * Whether a coupon payment is currently relevant for this loan — **upcoming**
 * (today is within `dueSoonDays` before the epoch's maturity) or **past due**
 * (today is on/after maturity). Drives whether the left card's third row shows
 * the "Scheduled coupon" line (a payment is due) rather than "Offtaker still
 * owed after coupon" (nothing due yet). `false` when the maturity date is
 * missing/unparseable — never fabricated. Pure — exported for unit testing.
 */
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

/**
 * Terminal-close detection (issue #882 explicit scope note) — see the module
 * doc comment. `false` whenever any input is unknown or the loan has no
 * outstanding senior on record.
 */
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
  errorDetails: string | null;
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
    errorDetails: string | null;
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
      errorMessage: waterfallError?.message ?? null,
      errorDetails: waterfallError?.details ?? null,
      rows,
    },
    summaryText,
    isTerminal,
    recordPaymentInput: buildRepaymentInput(amountBaseUnits, waterfall.data),
  };
}

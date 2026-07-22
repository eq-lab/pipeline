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
 *   - `senior_outstanding` (`useLoanBook`) and `offtaker_outstanding`
 *     (`useLoanFinancials`) are displayed **exactly as the backend serves
 *     them** — no client-side rescaling (issue #906; the former ×1000
 *     `scaleRegistryAmount` workaround has been removed).
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
import { formatFullUsd } from "@/utils/formatUsd";
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
  originator: string;
  backLabel: string;
  couponPeriod: string;
  seniorOutstanding: string;
  offtakerOwedAfter: string;
  amountInput: string;
  onAmountChange: (value: string) => void;
  dateInput: string;
  onDateChange: (value: string) => void;
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
  const [dateInput, setDateInput] = useState(todayDateInput());

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
  const offtakerOwedAfterUsd =
    offtakerOutstandingUsd == null
      ? null
      : Math.max(0, offtakerOutstandingUsd - (enteredUsd ?? 0));

  const couponPeriod = computeCouponPeriod(financials.data?.epoch ?? null);

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
          sub: "Minted to sPLUSD — lifts NAV",
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
    offtakerOwedAfter: usdFull(offtakerOwedAfterUsd),
    amountInput,
    onAmountChange: setAmountInput,
    dateInput,
    onDateChange: setDateInput,
    waterfall: {
      ready: waterfall.data != null,
      errorMessage: waterfall.error?.message ?? null,
      rows,
    },
    summaryText,
    isTerminal,
    recordPaymentInput: buildRepaymentInput(amountBaseUnits, waterfall.data),
  };
}

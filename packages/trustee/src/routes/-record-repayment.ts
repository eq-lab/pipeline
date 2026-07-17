/**
 * View-model + data wiring for the Trustee **Record Repayment — Principal**
 * full-page route (`loans.$id_.record-repayment.tsx`, issue #884, Figma node
 * `4116-11621`) — the principal-repayment sibling of the Record Coupon flow
 * (`-record-coupon.ts`, issue #882). Per `docs/FRONTEND.md` Code structure
 * rule 2 the `.tsx` route is JSX/styling only; this hook owns the live
 * fetches, the amount/date input state, and the value→display mapping.
 *
 * This module deliberately duplicates several of `-record-coupon.ts`'s pure
 * helpers (parse/scale conversions, terminal-repayment detection, the coupon
 * → "final" period computation) rather than importing them — each
 * `loans.$id_.*` route is a self-contained presenter (mirrors the project's
 * existing per-route hand-mirroring convention, e.g. TD-42's trustee/LP
 * pairs), so the two flows can diverge independently as either evolves.
 *
 * ## Scope (issue #884)
 * Previews the payment waterfall for a trustee-entered **final** offtaker
 * payment via the already-wired `useLoanWaterfall`, then performs the
 * on-chain `record_payment` write via `useRecordPayment` (page-level, like
 * #882's eventual write). Once the loan is fully repaid, the page also
 * exposes a **Close loan** action (`useCloseLoan`, issue #884's new on-chain
 * write) that moves the loan to `Closed`.
 *
 * ## Key difference from Record Coupon (#882) — REAL principal
 * The coupon flow forces `senior_principal_repaid` to `"0"` (interest-only —
 * principal stays deployed). This is a **principal repayment**: the
 * waterfall's real `senior_principal_returned` is displayed AND carried into
 * `senior_principal_repaid` verbatim. Equity is the residual after ALL five
 * carve-outs (principal + interest + fees) — clamped at 0, never negative —
 * so the six components still sum exactly to `offtaker_received`.
 *
 * ## Scale handling (identical to #882 — see `-record-coupon.ts`)
 *   - The `/waterfall` `amount` param and response fields are raw base units
 *     handled **as-is** (backend already accounts for USDC decimals) —
 *     `usdToBaseUnits`/`baseUnitsToUsd` are the identity conversions.
 *   - `senior_outstanding` (`useLoanBook`) / `offtaker_outstanding`
 *     (`useLoanFinancials`) are registry-sourced (#840, ×1000-too-small) —
 *     scaled via `scaleRegistryAmount` before use.
 *
 * ## Close-loan gating (issue #884 open question 3, resolved on start)
 * The Close-loan action shows once the loan is fully repaid: either the
 * entered amount is terminal (`isTerminalRepayment` — same cent-precision
 * detection as #882) OR the loan-book's outstanding senior is already `0`
 * (e.g. the trustee reloads this page after already recording the final
 * payment). `closureReason` picks `ScheduledMaturity` when `now >= maturity`
 * (the loan-book's rollover-aware `maturity`), else `EarlyRepayment` — per
 * the issue's resolved on-chain `ClosureReason` mapping.
 */
import { useEffect, useMemo, useState } from "react";
import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import type { Epoch } from "@/api/useLoanFinancials";
import { useLoanWaterfall } from "@/api/useLoanWaterfall";
import type { RepaymentInput } from "@/api/useRecordPayment";
import { formatFullUsd, scaleRegistryAmount } from "@/utils/formatUsd";
import { formatSubmittedDate } from "@/utils/formatDate";

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
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * The `/waterfall` `amount` param and all response fields are handled **as-is**
 * — the backend already accounts for USDC decimals, so the frontend applies NO
 * decimal scaling (mirrors #882): the entered USD dollar amount is sent
 * verbatim and the response integers are the dollar amounts to display
 * directly. (Distinct from the registry-sourced senior-outstanding /
 * offtaker-outstanding fields, which DO need the ×1000 #840 correction — see
 * `scaledUsd`.)
 */
export function usdToBaseUnits(usd: number | null): string {
  if (usd == null) return "0";
  return Math.round(usd).toString();
}

/** Parses a waterfall amount (already USD, backend-scaled) to a number. */
function baseUnitsToUsd(baseUnits: string | undefined): number | null {
  if (baseUnits == null) return null;
  const n = Number(baseUnits);
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
 * Builds the on-chain `RepaymentData` (issue #884) from the waterfall preview +
 * the entered offtaker amount (integer strings, backend-scaled as-is — passed
 * through unscaled to `record_payment`).
 *
 * This is the **principal repayment** flow: `senior_principal_repaid` carries
 * the waterfall's real `senior_principal_returned` (unlike the coupon flow's
 * forced `"0"`). The interest + fee carve-outs map 1:1; `equity_distributed`
 * is the residual after principal + interest + fees so the six components sum
 * exactly to `offtaker_received` (clamped at 0 — never negative). `null` until
 * a positive amount is entered and the preview resolves. Exported for unit
 * testing.
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

/**
 * A registry-sourced (`#840`, ×1000-too-small) base-6 decimal amount, scaled
 * and parsed to a plain USD number. `null` for anything missing/unparseable —
 * never fabricated.
 */
function scaledUsd(raw: string | null | undefined): number | null {
  const scaled = scaleRegistryAmount(raw);
  if (scaled == null) return null;
  const n = Number.parseFloat(scaled);
  return Number.isFinite(n) ? n : null;
}

/**
 * The final-period display (`"31 Mar → 24 Jun · 85 days"`) derived from the
 * loan's current epoch (`start_date` → `maturity_date`) — same computation as
 * #882's `computeCouponPeriod`, renamed for this page's "Final period" row.
 * `—` / `null` days when no epoch is on record (never fabricated).
 */
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
    label: `${formatSubmittedDate(epoch.start_date)} → ${formatSubmittedDate(epoch.maturity_date)} · ${days} days`,
    days,
  };
}

/**
 * Terminal-repayment detection (mirrors #882's `isTerminalRepayment`) — `true`
 * when the entered amount covers (≥) the loan's outstanding senior AND the
 * waterfall's own `senior_principal_returned` equals it exactly (to the cent,
 * guarding float drift from the two independent unit conversions). Gates the
 * Close-loan action alongside the already-zero-outstanding case (see
 * `useRecordRepayment`).
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

/**
 * Picks the on-chain `ClosureReason` for a repayment close (issue #884,
 * resolved open questions 1 & 2): `"ScheduledMaturity"` when `now >=
 * maturity` (the loan-book's rollover-aware `currentMaturityDate`), else
 * `"EarlyRepayment"`. Pure — exported for unit testing.
 */
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
  originator: string;
  backLabel: string;
  commodity: string;
  finalPeriod: string;
  seniorOutstandingBefore: string;
  offtakerOwed: string;
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
  /**
   * The on-chain `RepaymentData` for `record_payment` (base-unit strings);
   * `null` until a positive amount is entered and the preview resolves. The
   * page passes this to `useRecordPayment` on confirm (#884).
   */
  recordPaymentInput: RepaymentInput | null;
  /**
   * `true` once the loan is fully repaid — the terminal entered amount OR the
   * loan-book's outstanding senior is already `0` — and the Close-loan action
   * should be shown.
   */
  showCloseLoan: boolean;
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
  const [dateInput, setDateInput] = useState(todayDateInput());

  // Debounce the amount that drives the waterfall query (the input field itself
  // stays fully responsive) so holding/typing doesn't fire a `/waterfall`
  // request per keystroke (mirrors #882).
  const [debouncedAmount, setDebouncedAmount] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAmount(amountInput), 400);
    return () => clearTimeout(timer);
  }, [amountInput]);

  const enteredUsd = parseUsdInput(debouncedAmount);
  const amountBaseUnits = usdToBaseUnits(enteredUsd);
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

  const outstandingSeniorUsd = scaledUsd(entry?.senior_outstanding);
  const offtakerOutstandingUsd = scaledUsd(
    financials.data?.offtaker_outstanding,
  );

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

  const rows: WaterfallRow[] = waterfall.data
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

  const showCloseLoan =
    isTerminal || (outstandingSeniorUsd != null && outstandingSeniorUsd <= 0);

  const maturity = entry?.maturity ?? null;
  const reason =
    maturity == null
      ? null
      : closureReason(Math.floor(Date.now() / 1000), maturity);

  return {
    state,
    errorMessage: loanBook.error?.message ?? null,
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
    onDateChange: setDateInput,
    waterfall: {
      ready: waterfall.data != null,
      errorMessage: waterfall.error?.message ?? null,
      rows,
    },
    summaryText,
    recordPaymentInput,
    showCloseLoan,
    closureReason: reason,
  };
}

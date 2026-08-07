/**
 * View-model + data wiring for the Trustee **Risk Council — Amend economics
 * (off-cycle re-term)** page (`risk-council.reterm.$id.tsx`, issue #782, Figma
 * node `4116-13481`). Per `docs/FRONTEND.md` Code structure rule 2 the `.tsx`
 * route is JSX/styling only; this hook owns the live fetches + value→display
 * mapping (mirrors `-risk-council-escalate.ts`).
 *
 * ## Flow (spec `docs/product-specs/trustee-dashboard.md` §"Type 3", flow 11)
 * Off-cycle re-term is a RISK_COUNCIL `amendEconomics` proposal. Unlike
 * Escalate-to-Default (flow 10, which the Trustee drafts + submits), this is a
 * **read-only REVIEW** screen: the Trustee dashboard only shows the review,
 * evidence, and voting status — execution stays with the Risk Council Safe
 * after the 24h timelock, GUARDIAN-cancelable. There is no submit action.
 *
 * ## Real vs. mock (data-sourcing convention)
 * **Real** — the loan's CURRENT terms, per-loan:
 *   - Loan (originator — commodity), CCR (`ccr_bps`), Maturity (`maturity`) —
 *     the matching `useLoanBook` entry.
 *   - Current coupon — the current epoch APY (`useLoanFinancials`
 *     `epoch.current_apy_bps`); falls back to the loan-book `rate` when no
 *     epoch is on record. `—` when neither is available (never fabricated).
 *
 * **Mock** — the PROPOSED amendment + the proposal timestamp. No Safe/proposal
 * backend exists (`RiskCouncilSafe.propose(amendEconomics)` is RISK_COUNCIL-
 * only, not Trustee-callable, and nothing serves a pending proposal), so the
 * proposed coupon / maturity extension / covenant / expected status and the
 * "21 Jun 2026, 14:32 UTC" stamp are static Figma literals until that infra
 * lands — the same convention as flow 10's proposal section.
 */
import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import { formatBpsRate } from "@/utils/formatUsd";
import { formatMaturityDate } from "@/utils/formatDate";
import { toUserError } from "@/utils/userError";

// ── Mock constants (see module doc — no proposal backend) ────────────────────

/** MOCK — no proposal timestamp is served (the Safe/proposal layer is unbuilt). */
export const MOCK_PROPOSAL_TIMESTAMP = "21 Jun 2026, 14:32 UTC";

/** MOCK — the proposed `amendEconomics` payload; no backend serves a pending proposal. */
export const MOCK_PROPOSED_TERMS = {
  coupon: "14.5%",
  maturityExtension: "+45 days",
  covenant: "weekly reporting",
  expectedStatus: "Watchlist",
} as const;

// ── Pure helpers (exported for unit tests) ──────────────────────────────────

/** `"Delta Commodities — Coffee"` — originator + commodity; `—` for missing parts. */
export function formatLoanLabel(
  originator: string | null | undefined,
  commodity: string | null | undefined,
): string {
  return `${originator ?? "—"} — ${commodity ?? "—"}`;
}

/**
 * The loan's CURRENT coupon — the current epoch APY (`current_apy_bps`), or the
 * loan-book `rate` decimal fraction when no epoch is on record. `—` when
 * neither is available. Never fabricated.
 */
export function formatCurrentCoupon(
  apyBps: number | null | undefined,
  rateDecimal: string | null | undefined,
): string {
  if (apyBps != null && Number.isFinite(apyBps)) return formatBpsRate(apyBps);
  if (rateDecimal != null) {
    const n = parseFloat(rateDecimal);
    if (Number.isFinite(n)) return `${(n * 100).toFixed(1)}%`;
  }
  return "—";
}

/** `"114%"` (whole percent) from `ccr_bps`; `—` when unavailable. */
export function formatCcrPct(ccrBps: number | null | undefined): string {
  if (ccrBps == null || !Number.isFinite(ccrBps)) return "—";
  return `${Math.round(ccrBps / 100)}%`;
}

// ── View types ──────────────────────────────────────────────────────────────

export interface RetermCurrentTerms {
  loan: string;
  coupon: string;
  maturity: string;
  ccr: string;
}

/** All MOCK — no proposal backend (see module doc). */
export interface RetermProposedTerms {
  coupon: string;
  maturityExtension: string;
  covenant: string;
  expectedStatus: string;
}

export interface RiskCouncilRetermView {
  state: "loading" | "error" | "not-found" | "ready";
  errorMessage: string | null;
  errorDetails: string | null;
  loanId: string;
  /** MOCK — see module doc. */
  timestamp: string;
  current: RetermCurrentTerms;
  /** MOCK — see module doc. */
  proposed: RetermProposedTerms;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires the matching loan-book row (identity + CCR + maturity) and the loan's
 * financials (current epoch coupon) for `loanId`, composed with the still-mock
 * proposed-amendment section. Read-only — no submit.
 */
export function useRiskCouncilReterm(loanId: string): RiskCouncilRetermView {
  const loanBook = useLoanBook();
  const financials = useLoanFinancials(loanId);

  const entry = loanBook.data?.loans.find((l) => l.loan_id === loanId);

  const state: RiskCouncilRetermView["state"] = loanBook.isLoading
    ? "loading"
    : loanBook.error
      ? "error"
      : entry == null
        ? "not-found"
        : "ready";

  const loanBookError = loanBook.error
    ? toUserError(loanBook.error, "Failed to load the loan.")
    : null;

  return {
    state,
    errorMessage: loanBookError?.message ?? null,
    errorDetails: loanBookError?.details ?? null,
    loanId,
    timestamp: MOCK_PROPOSAL_TIMESTAMP,
    current: {
      loan: formatLoanLabel(entry?.originator, entry?.commodity),
      coupon: formatCurrentCoupon(
        financials.data?.epoch?.current_apy_bps,
        entry?.rate,
      ),
      maturity: entry != null ? formatMaturityDate(entry.maturity) : "—",
      ccr: formatCcrPct(entry?.ccr_bps ?? null),
    },
    proposed: { ...MOCK_PROPOSED_TERMS },
  };
}

/**
 * View-model + data wiring for the Trustee Risk Council — Escalate page
 * (`risk-council.escalate.$id.tsx`). Per `docs/FRONTEND.md` Code structure
 * rule 2 the `.tsx` route is JSX/styling only; this hook owns the live
 * fetches and the value→display mapping (mirrors `-useLoanDetail.ts` /
 * `-record-coupon.ts`).
 *
 * spec: docs/frontend/trustee-flows.md#escalate-to-default-flow-10--proposal-builder-not-a-typed-payload
 * (proposal-builder model, real-vs-mock data sourcing).
 */
import { useState } from "react";
import { useLoanBook } from "@/api/useLoanBook";
import type { TopConcentration } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import { useLoanCcrHistory } from "@/api/useLoanCcrHistory";
import { buildCcrTrend, type CcrTrend } from "./-useLoanDetail";
import {
  classifyCcr,
  type CcrBand,
  MAINTENANCE_MARGIN_BPS,
  HEALTHY_MARGIN_BPS,
} from "./-useLoansTable";
import { formatFullUsd } from "@/utils/formatUsd";
import { toUserError } from "@/utils/userError";

// ── Mock constants (see module doc — no backend source, not per-loan) ───────

/** MOCK — no "watchlist since" timestamp is served anywhere (issue #859's gap). */
export const MOCK_DAYS_ON_WATCHLIST = "18";

/** MOCK — no if-defaulted portfolio-impact projection endpoint exists. */
export const MOCK_AT_RISK_PROJECTED_PCT = "4.3%";

/** Protocol hard-margin-call floor (110%), in whole percent — the lowest CCR band (#939). */
const MARGIN_CALL_PCT = 110;
const MAINTENANCE_MARGIN_PCT = MAINTENANCE_MARGIN_BPS / 100;
const HEALTHY_MARGIN_PCT = HEALTHY_MARGIN_BPS / 100;

// ── Pure helpers (exported for unit tests) ──────────────────────────────────

// Protocol CCR thresholds (130/120/110%, spec §9.6); null once at/below the lowest.
export function nextCcrAlertPct(ccrBps: number | null): number | null {
  if (ccrBps == null || !Number.isFinite(ccrBps)) return null;
  const pct = ccrBps / 100;
  if (pct > HEALTHY_MARGIN_PCT) return null;
  if (pct > MAINTENANCE_MARGIN_PCT) return MAINTENANCE_MARGIN_PCT;
  if (pct > MARGIN_CALL_PCT) return MARGIN_CALL_PCT;
  return null;
}

/**
 * The CCR ledger-row text, e.g. `"114% — next alert at 110%"`. `—` when CCR
 * is unavailable; omits the alert clause once there is no further threshold
 * to name.
 */
export function formatCcrLine(ccrBps: number | null): string {
  if (ccrBps == null || !Number.isFinite(ccrBps)) return "—";
  const pct = Math.round(ccrBps / 100);
  const alert = nextCcrAlertPct(ccrBps);
  return alert != null ? `${pct}% — next alert at ${alert}%` : `${pct}%`;
}

/** `"$2,300,000 / $1,840,000"` — Facility / senior deployed, served display-scale as-is (#906). */
export function formatFacilityLine(
  principal: string | null | undefined,
  seniorOutstanding: string | null | undefined,
): string {
  return `${formatFullUsd(principal)} / ${formatFullUsd(seniorOutstanding)}`;
}

/**
 * Repaid to date = `offtaker − offtaker_outstanding` (both served display-scale
 * as-is, #906), clamped at 0. `—` when either financials field is unavailable —
 * never fabricated.
 */
export function buildRepaidToDate(
  offtaker: string | null | undefined,
  offtakerOutstanding: string | null | undefined,
): string {
  const total = offtaker;
  const outstanding = offtakerOutstanding;
  if (total == null || outstanding == null) return "—";
  const totalNum = parseFloat(total);
  const outstandingNum = parseFloat(outstanding);
  if (!Number.isFinite(totalNum) || !Number.isFinite(outstandingNum)) {
    return "—";
  }
  const repaid = Math.max(0, totalNum - outstandingNum);
  return formatFullUsdNumber(repaid);
}

/** Formats an already-scaled USD number as fully-expanded whole dollars. */
function formatFullUsdNumber(n: number): string {
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;
}

/**
 * The real 7-day spot-change fragment (`"−18% 7d"`), matching the Loans page's
 * never-fabricate rule (exec-plan RISK 3): the served basis is 7-day, never
 * relabelled "30d" to match the Figma literal. `null` when unavailable (the
 * label then omits the parenthetical entirely).
 */
function formatChangeFragment(
  spotChange7d: string | null | undefined,
): string | null {
  if (spotChange7d == null) return null;
  const change = parseFloat(spotChange7d);
  if (!Number.isFinite(change)) return null;
  const pct = Math.round(Math.abs(change) * 100);
  // U+2212 MINUS SIGN / U+002B PLUS SIGN, matching the Figma glyphs.
  const sign = change < 0 ? "−" : "+";
  return `${sign}${pct}% 7d`;
}

/** `"Collateral (coffee −18% 7d)"`, or plain `"Collateral"` when no spot change is served. */
export function buildCollateralLabel(
  commodity: string,
  spotChange7d: string | null | undefined,
): string {
  const change = formatChangeFragment(spotChange7d);
  return change != null
    ? `Collateral (${commodity.toLowerCase()} ${change})`
    : "Collateral";
}

/**
 * Formats a decimal-fraction string (e.g. `"0.0430"`) as a one-decimal
 * percentage (`"4.3%"`). `null`/non-finite → `"—"`. Hand-mirrored from
 * `-useLoansTable.ts`'s private `formatFractionPct` (not exported there) —
 * see `docs/exec-plans/tech-debt-tracker.md`.
 */
function formatFractionPct(fraction: string | null | undefined): string {
  if (fraction == null) return "—";
  const num = parseFloat(fraction);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

/**
 * The "Portfolio impact if defaulted" at-risk row: the real current
 * WatchList+Default % and the MOCK if-defaulted projection (see module doc —
 * no projection endpoint exists).
 */
export function buildAtRiskLine(atRiskPct: string | null | undefined): {
  current: string;
  projected: string;
} {
  return {
    current: formatFractionPct(atRiskPct),
    projected: MOCK_AT_RISK_PROJECTED_PCT,
  };
}

/**
 * The commodity-concentration row. The loan-book summary serves only ONE
 * portfolio-wide top concentration (a single commodity + share), so its
 * figure is only rendered when it actually names THIS loan's commodity —
 * otherwise `—` (never fabricate a per-commodity share the endpoint doesn't
 * serve for every commodity).
 */
export function buildConcentration(
  commodity: string,
  topConcentration: TopConcentration | null | undefined,
): { label: string; value: string } {
  const label = `${commodity} concentration`;
  if (
    topConcentration == null ||
    topConcentration.commodity.toLowerCase() !== commodity.toLowerCase()
  ) {
    return { label, value: "—" };
  }
  return { label, value: formatFractionPct(topConcentration.share) };
}

// ── View types ──────────────────────────────────────────────────────────────

export interface LedgerView {
  facilityAndSeniorDeployed: string;
  repaidToDate: string;
  collateralLabel: string;
  collateralValue: string;
  ccrLine: string;
  ccrBand: CcrBand | null;
  /** MOCK — see module doc. */
  daysOnWatchlist: string;
}

export interface PortfolioImpactView {
  atRiskCurrentPct: string;
  /** MOCK — see module doc. */
  atRiskProjectedPct: string;
  concentrationLabel: string;
  concentrationValue: string;
}

export type ProposalStatus = "draft" | "submitted";

export interface RiskCouncilEscalateView {
  state: "loading" | "error" | "not-found" | "ready";
  errorMessage: string | null;
  errorDetails: string | null;
  loanId: string;
  originator: string;
  title: string;
  ledger: LedgerView;
  /** `null` while the CCR-history series has no points yet (loading, or never priced). */
  ccrTrend: CcrTrend | null;
  portfolioImpact: PortfolioImpactView;
  /** Mock Draft/Submitted proposal state — local UI only, no network/wallet. */
  status: ProposalStatus;
  /** Free-form proposal name (`Risk UX.md` proposal-builder — the Trustee's ask, not composed calldata). */
  proposalName: string;
  /** Free-form proposal text / rationale. */
  proposalText: string;
  onNameChange: (value: string) => void;
  onTextChange: (value: string) => void;
  /** `true` once both name and text are non-empty — the submit control's gate. */
  canSubmit: boolean;
  onSubmit: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires the matching loan-book row (ledger identity, facility/senior/
 * collateral/CCR, at-risk %, concentration), the loan's financials (repaid to
 * date), and the CCR-history series (trend chart) for `loanId`; composes them
 * with the still-mock sections (days on watchlist, if-defaulted projection)
 * and the local mock Draft→Submitted proposal state.
 */
export function useRiskCouncilEscalate(
  loanId: string,
): RiskCouncilEscalateView {
  const loanBook = useLoanBook();
  const financials = useLoanFinancials(loanId);
  const [status, setStatus] = useState<ProposalStatus>("draft");
  const [proposalName, setProposalName] = useState("");
  const [proposalText, setProposalText] = useState("");
  const canSubmit =
    proposalName.trim().length > 0 && proposalText.trim().length > 0;

  const entry = loanBook.data?.loans.find((l) => l.loan_id === loanId);

  // CCR-history series (#879) — from the loan's origination through now, daily.
  // Mirrors `-useLoanDetail.ts`'s `ccrFrom` computation; the hook self-disables
  // until `from` is known.
  const ccrFrom =
    entry != null ? entry.maturity - entry.duration_days * 86_400 : null;
  const ccrHistory = useLoanCcrHistory(loanId, ccrFrom);

  const state: RiskCouncilEscalateView["state"] = loanBook.isLoading
    ? "loading"
    : loanBook.error
      ? "error"
      : entry == null
        ? "not-found"
        : "ready";

  const originator = entry?.originator ?? "";
  const title =
    entry != null
      ? `Escalate to Risk Council — ${originator}`
      : `Escalate to Risk Council — Loan #${loanId}`;

  const atRisk = buildAtRiskLine(
    loanBook.data?.summary.at_risk_wl_and_default_pct,
  );
  const concentration = buildConcentration(
    entry?.commodity ?? "",
    loanBook.data?.summary.top_concentration,
  );

  const loanBookError = loanBook.error
    ? toUserError(loanBook.error, "Failed to load the loan.")
    : null;

  return {
    state,
    errorMessage: loanBookError?.message ?? null,
    errorDetails: loanBookError?.details ?? null,
    loanId,
    originator,
    title,
    ledger: {
      facilityAndSeniorDeployed: formatFacilityLine(
        entry?.principal,
        entry?.senior_outstanding,
      ),
      repaidToDate: buildRepaidToDate(
        financials.data?.offtaker,
        financials.data?.offtaker_outstanding,
      ),
      collateralLabel: buildCollateralLabel(
        entry?.commodity ?? "—",
        entry?.spot_change_7d,
      ),
      collateralValue: formatFullUsd(entry?.collateral),
      ccrLine: formatCcrLine(entry?.ccr_bps ?? null),
      ccrBand: classifyCcr(entry?.ccr_bps ?? null),
      daysOnWatchlist: MOCK_DAYS_ON_WATCHLIST,
    },
    ccrTrend: buildCcrTrend(ccrHistory),
    portfolioImpact: {
      atRiskCurrentPct: atRisk.current,
      atRiskProjectedPct: atRisk.projected,
      concentrationLabel: concentration.label,
      concentrationValue: concentration.value,
    },
    status,
    proposalName,
    proposalText,
    onNameChange: setProposalName,
    onTextChange: setProposalText,
    canSubmit,
    onSubmit: () => {
      if (canSubmit) setStatus("submitted");
    },
  };
}

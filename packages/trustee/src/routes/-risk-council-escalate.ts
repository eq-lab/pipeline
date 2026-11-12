// spec: docs/frontend/trustee-flows.md#risk-council-actions
import type { TopConcentration } from "@/api/useLoanBook";
import { useLoanSecurity } from "@/api/useLoanSecurity";
import type { UseLoanSecurityResult } from "@/api/useLoanSecurity";
import { formatFractionPct } from "@/utils/formatFractionPct";
import { formatFullUsd } from "@/utils/formatUsd";
import { useLoanBook } from "@/api/useLoanBook";
import {
  buildSecurityCard,
  formatLtvBps,
  ltvRowText,
  type LtvTone,
} from "./-loanSecurity";
import { formatChainAmount } from "./-repayment-recovery";
import {
  chainStateRows,
  notAvailableNote,
  useRiskCouncilActionView,
  useRiskCouncilLoanBase,
  type ActionView,
  type LabelValue,
  type PageState,
} from "./-risk-council-shared";

export const SET_DEFAULT_STATUSES: ReadonlySet<string> = new Set([
  "Performing",
  "WatchList",
]);

export const DEFAULT_EFFECTS =
  "The loan moves to Default. On the first default its outstanding principal moves out of the staking vault into a pocket for this loan; the sPLUSD share price falls by the amount moved.";

export const DEFAULT_NO_ROLE =
  "Declaring a default belongs to the Risk Council.";

export function formatFacilityLine(
  principal: string | null | undefined,
  seniorOutstanding: string | null | undefined,
): string {
  return `${formatFullUsd(principal)} / ${formatFullUsd(seniorOutstanding)}`;
}

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

export type Eligibility =
  | { kind: "eligible" }
  | { kind: "default" }
  | { kind: "unavailable"; note: string }
  | { kind: "unknown" };

export function escalateEligibility(status: string | null): Eligibility {
  if (status == null) return { kind: "unknown" };
  if (SET_DEFAULT_STATUSES.has(status)) return { kind: "eligible" };
  if (status === "Default") return { kind: "default" };
  return {
    kind: "unavailable",
    note: notAvailableNote(status) ?? `Not available for a ${status} loan.`,
  };
}

export interface LedgerSecurityView {
  value: string;
  ltvLine: string;
  ltvTone: LtvTone;
  ratios: string;
  priceStale: boolean;
}

export interface LedgerView {
  facilityAndSeniorDeployed: string;
  principalRepaid: string;
  security: LedgerSecurityView | null;
  daysOnWatchlist: string;
}

export function buildLedgerSecurity(
  result: UseLoanSecurityResult,
): LedgerSecurityView | null {
  const card = buildSecurityCard(result);
  if (card.state === "hidden" || card.state === "no-terms") return null;
  if (card.state !== "ready") {
    const text = ltvRowText(card, result.data) ?? "—";
    return {
      value: text,
      ltvLine: text,
      ltvTone: "neutral",
      ratios: text,
      priceStale: false,
    };
  }
  const terms = result.data?.terms;
  return {
    value: formatFullUsd(result.data?.valuation?.value),
    ltvLine: ltvRowText(card, result.data) ?? card.ltv,
    ltvTone: card.ltvTone,
    ratios: `${formatLtvBps(terms?.advance_ratio_bps)} / ${formatLtvBps(terms?.margin_call_ratio_bps)}`,
    priceStale: card.priceStale,
  };
}

export interface PortfolioImpactView {
  atRiskCurrentPct: string;
  concentrationLabel: string;
  concentrationValue: string;
}

export interface RiskCouncilEscalateView {
  state: PageState;
  errorMessage: string | null;
  errorDetails: string | null;
  loanId: string;
  originator: string;
  title: string;
  ledger: LedgerView;
  portfolioImpact: PortfolioImpactView;
  chainState: LabelValue[];
  eligibility: Eligibility;
  effects: string;
  action: ActionView;
}

export function useRiskCouncilEscalate(
  chainId: number,
  loanId: string,
): RiskCouncilEscalateView {
  const loanBook = useLoanBook();
  const base = useRiskCouncilLoanBase(chainId, loanId);
  const entry = base.entry;
  const security = useLoanSecurity(chainId, loanId);

  const eligibility = escalateEligibility(base.chainStatus);
  const action = useRiskCouncilActionView({
    chainId,
    call:
      base.loanId === null ? null : { fn: "set_default", loanId: base.loanId },
    fn: "set_default",
    noRoleCopy: DEFAULT_NO_ROLE,
    labels: {
      now: "Declare default",
      schedule: "Schedule default",
      execute: "Execute default",
    },
    enabled: eligibility.kind === "eligible",
  });

  const originator = entry?.originator ?? "";
  const concentration = buildConcentration(
    entry?.commodity ?? "",
    loanBook.data?.summary.top_concentration,
  );
  const repaid = base.chainState?.money.repaid;

  return {
    state: base.state,
    errorMessage: base.errorMessage,
    errorDetails: base.errorDetails,
    loanId,
    originator,
    title:
      entry != null
        ? `Escalate to Default — ${originator}`
        : `Escalate to Default — Loan #${loanId}`,
    ledger: {
      facilityAndSeniorDeployed: formatFacilityLine(
        entry?.principal,
        entry?.senior_outstanding,
      ),
      principalRepaid:
        repaid == null ? "—" : formatChainAmount(repaid, chainId),
      security: buildLedgerSecurity(security),
      daysOnWatchlist:
        entry?.days_on_watchlist == null
          ? "—"
          : String(entry.days_on_watchlist),
    },
    portfolioImpact: {
      atRiskCurrentPct: formatFractionPct(
        loanBook.data?.summary.at_risk_wl_and_default_pct,
      ),
      concentrationLabel: concentration.label,
      concentrationValue: concentration.value,
    },
    chainState: chainStateRows(chainId, base.chainState, [
      "status",
      "outstanding",
      "writtenDown",
      "pocket",
    ]),
    eligibility,
    effects: DEFAULT_EFFECTS,
    action,
  };
}

// spec: docs/frontend/trustee-flows.md#risk-council-actions
import type { TopConcentration } from "@/api/useLoanBook";
import { useLoanCcrHistory } from "@/api/useLoanCcrHistory";
import { formatFractionPct } from "@/utils/formatFractionPct";
import { formatFullUsd } from "@/utils/formatUsd";
import { useLoanBook } from "@/api/useLoanBook";
import { buildCcrTrend, ccrSeriesFrom, type CcrTrend } from "./-useLoanDetail";
import {
  classifyCcr,
  type CcrBand,
  MAINTENANCE_MARGIN_BPS,
  HEALTHY_MARGIN_BPS,
} from "./-useLoansTable";
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

const MARGIN_CALL_PCT = 110;
const MAINTENANCE_MARGIN_PCT = MAINTENANCE_MARGIN_BPS / 100;
const HEALTHY_MARGIN_PCT = HEALTHY_MARGIN_BPS / 100;

export const SET_DEFAULT_STATUSES: ReadonlySet<string> = new Set([
  "Performing",
  "WatchList",
]);

export const DEFAULT_EFFECTS =
  "The loan moves to Default. On the first default its outstanding principal moves out of the staking vault into a pocket for this loan; the sPLUSD share price falls by the amount moved.";

export const DEFAULT_NO_ROLE =
  "Declaring a default belongs to the Risk Council.";

export function nextCcrAlertPct(ccrBps: number | null): number | null {
  if (ccrBps == null || !Number.isFinite(ccrBps)) return null;
  const pct = ccrBps / 100;
  if (pct > HEALTHY_MARGIN_PCT) return null;
  if (pct > MAINTENANCE_MARGIN_PCT) return MAINTENANCE_MARGIN_PCT;
  if (pct > MARGIN_CALL_PCT) return MARGIN_CALL_PCT;
  return null;
}

export function formatCcrLine(ccrBps: number | null): string {
  if (ccrBps == null || !Number.isFinite(ccrBps)) return "—";
  const pct = Math.round(ccrBps / 100);
  const alert = nextCcrAlertPct(ccrBps);
  return alert != null ? `${pct}% — next alert at ${alert}%` : `${pct}%`;
}

export function formatFacilityLine(
  principal: string | null | undefined,
  seniorOutstanding: string | null | undefined,
): string {
  return `${formatFullUsd(principal)} / ${formatFullUsd(seniorOutstanding)}`;
}

function formatChangeFragment(
  spotChange7d: string | null | undefined,
): string | null {
  if (spotChange7d == null) return null;
  const change = parseFloat(spotChange7d);
  if (!Number.isFinite(change)) return null;
  const pct = Math.round(Math.abs(change) * 100);
  const sign = change < 0 ? "−" : "+";
  return `${sign}${pct}% 7d`;
}

export function buildCollateralLabel(
  commodity: string,
  spotChange7d: string | null | undefined,
): string {
  const change = formatChangeFragment(spotChange7d);
  return change != null
    ? `Collateral (${commodity.toLowerCase()} ${change})`
    : "Collateral";
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

export interface LedgerView {
  facilityAndSeniorDeployed: string;
  principalRepaid: string;
  collateralLabel: string;
  collateralValue: string;
  ccrLine: string;
  ccrBand: CcrBand | null;
  daysOnWatchlist: string;
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
  ccrTrend: CcrTrend | null;
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
  const ccrHistory = useLoanCcrHistory(chainId, loanId, ccrSeriesFrom(entry));

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
      collateralLabel: buildCollateralLabel(
        entry?.commodity ?? "—",
        entry?.spot_change_7d,
      ),
      collateralValue: formatFullUsd(entry?.collateral),
      ccrLine: formatCcrLine(entry?.ccr_bps ?? null),
      ccrBand: classifyCcr(entry?.ccr_bps ?? null),
      daysOnWatchlist:
        entry?.days_on_watchlist == null
          ? "—"
          : String(entry.days_on_watchlist),
    },
    ccrTrend: buildCcrTrend(ccrHistory),
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

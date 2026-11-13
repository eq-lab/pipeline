// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useLoanBook, type LoanBookEntry } from "@/api/useLoanBook";
import {
  useRiskCouncilAccess,
  useRiskCouncilHubLookups,
  type CouncilCall,
} from "@/api/useRiskCouncil";
import { useSessionState } from "@/auth/sessionStore";
import {
  accessAction,
  formatReadyAt,
  NO_LONGER_SCHEDULED,
  riskCouncilRoleLine,
} from "@/lib/accessManagerAction";
import { ENV } from "@/lib/env";
import { useScheduledOps } from "@/lib/riskCouncilOps";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import { formatMaturityDate } from "@/utils/formatDate";
import { formatChainAmount } from "./-repayment-recovery";
import {
  formatLoanLabel,
  formatSignedChainAmount,
} from "./-risk-council-shared";
import { DEFAULT_NO_ROLE } from "./-risk-council-escalate";

export const HUB_INTRO =
  "The Risk Council acts through the access manager. Declaring a default executes at once; every other Risk Council action waits 24 hours, and the Guardian or the Admin can cancel it during the wait.";
export const HUB_EMPTY = "No scheduled operations found.";
export const HUB_FOOTNOTE =
  "Lists operations scheduled from this console in this session, and declared defaults or cures pending for any loan. Security terms, flag resolutions, consent releases and the inspector panel appear only when scheduled from this console in this session. Other scheduled operations need an indexer and are not listed yet.";
export const INSPECTORS_ROW_LABEL = "All loans";
export const HUB_NO_ROLE =
  "Risk Council actions belong to the Risk Council. Pending operations are visible to the scheduling wallet only.";

export type HubRoute =
  | "escalate"
  | "reterm"
  | "writedown"
  | "security"
  | "inspectors";

export interface HubLink {
  label: string;
  route: HubRoute;
}

export interface ScheduledRow {
  key: string;
  loanLabel: string;
  action: string;
  args: string;
  executableFrom: string;
  state: string;
  link: { route: HubRoute; loanId: string | null } | null;
}

export interface LoanIndexRow {
  loanId: string;
  loanLabel: string;
  status: string;
  links: HubLink[];
}

export interface RiskCouncilHubView {
  chainId: number;
  blockedReason: string | null;
  intro: string;
  roleLine: string | null;
  noRole: boolean;
  rows: ScheduledRow[];
  loans: LoanIndexRow[];
  loading: boolean;
}

const ACTION_LABELS: Record<CouncilCall["fn"], string> = {
  set_default: "Declare default",
  cure: "Cure",
  amend_economics: "Amend economics",
  adjust_interest: "Adjust interest",
  write_down: "Write down",
  close_defaulted: "Close defaulted loan",
  set_terms: "Set security terms",
  resolve_flag: "Resolve flag",
  release_with_consent: "Release with consent",
  set_inspectors: "Set inspector panel",
};

const ACTION_ROUTES: Record<CouncilCall["fn"], HubRoute> = {
  set_default: "escalate",
  cure: "writedown",
  amend_economics: "reterm",
  adjust_interest: "reterm",
  write_down: "writedown",
  close_defaulted: "writedown",
  set_terms: "security",
  resolve_flag: "security",
  release_with_consent: "security",
  set_inspectors: "inspectors",
};

export function formatCallArgs(call: CouncilCall, chainId: number): string {
  switch (call.fn) {
    case "amend_economics":
      return `${call.rateBps} bps · maturity ${formatMaturityDate(call.maturity)}`;
    case "adjust_interest":
      return `${formatSignedChainAmount(call.delta, chainId)} · reason hash ${call.reasonHash.slice(0, 10)}…`;
    case "write_down":
      return formatChainAmount(call.amount, chainId);
    case "close_defaulted":
      return call.reason;
    case "set_terms":
      return `advance ${bpsToPercent(call.terms.advanceRatioBps)}% · margin call ${bpsToPercent(call.terms.marginCallRatioBps)}%`;
    case "resolve_flag":
      return `${call.outcome} · record #${call.recordId}`;
    case "release_with_consent":
      return `record #${call.recordId} · consent hash ${call.consentHash.slice(0, 10)}…`;
    case "set_inspectors":
      return `${call.inspectors.length} ${call.inspectors.length === 1 ? "inspector" : "inspectors"}`;
    default:
      return "—";
  }
}

const SECURITY_LINK: HubLink = { label: "Security", route: "security" };

export function loanLinks(status: string): HubLink[] {
  const security = status === "Closed" ? [] : [SECURITY_LINK];
  if (status === "Performing" || status === "WatchList") {
    return [
      { label: "Declare default", route: "escalate" },
      { label: "Amend economics", route: "reterm" },
      ...security,
    ];
  }
  if (status === "Default") {
    return [
      { label: "Resolve default", route: "writedown" },
      { label: "Amend economics", route: "reterm" },
      ...security,
    ];
  }
  return security;
}

function bpsToPercent(bps: number): string {
  return String(bps / 100);
}

export function callLoanId(
  call: CouncilCall,
  pageLocal: { loanId?: number } | undefined,
): number | null {
  if ("loanId" in call) return call.loanId;
  return pageLocal?.loanId ?? null;
}

function loanLabelFor(
  loans: ReadonlyArray<LoanBookEntry>,
  loanId: number,
): string {
  const entry = loans.find((l) => l.loan_id === String(loanId));
  return entry == null
    ? `Loan #${loanId}`
    : `${formatLoanLabel(entry.originator, entry.commodity)} (#${loanId})`;
}

export function useRiskCouncilHub(): RiskCouncilHubView {
  const session = useSessionState();
  const chainId = session.chainId ?? ENV.STELLAR_CHAIN_ID;
  const blockedReason = stellarOnlyActionReason(chainId);
  const loanBook = useLoanBook(chainId);
  const loans = blockedReason ? [] : (loanBook.data?.loans ?? []);
  const access = useRiskCouncilAccess(chainId, null, "set_default");
  const ops = useScheduledOps(chainId);

  const canCall = access.data?.canCall;
  const noRole = canCall != null && !canCall.immediate && canCall.delay === 0;
  const lookups = useRiskCouncilHubLookups(
    chainId,
    loans,
    ops,
    canCall != null && !noRole,
  );

  const action = accessAction(canCall, access.data?.schedule ?? undefined);
  const roleLine =
    blockedReason != null || canCall == null
      ? null
      : noRole
        ? HUB_NO_ROLE
        : riskCouncilRoleLine(
            action ?? (canCall?.delay ? "schedule" : null),
            canCall?.delay ?? null,
            null,
            DEFAULT_NO_ROLE,
          );

  const rows: ScheduledRow[] = [];
  for (const lookup of lookups.lookups) {
    if (lookup == null) continue;
    const { call, readyAt, pageLocal } = lookup;
    const pending = readyAt > 0;
    if (!pending && (pageLocal == null || pageLocal.executedHere)) continue;
    const loanId = callLoanId(call, pageLocal);
    rows.push({
      key: `${call.fn}:${JSON.stringify(call)}`,
      loanLabel:
        call.fn === "set_inspectors"
          ? INSPECTORS_ROW_LABEL
          : loanId === null
            ? "—"
            : loanLabelFor(loans, loanId),
      action: ACTION_LABELS[call.fn],
      args: formatCallArgs(call, chainId),
      executableFrom: pending ? formatReadyAt(readyAt) : "—",
      state: pending ? "Scheduled" : NO_LONGER_SCHEDULED,
      link:
        call.fn !== "set_inspectors" && loanId === null
          ? null
          : {
              route: ACTION_ROUTES[call.fn],
              loanId: loanId === null ? null : String(loanId),
            },
    });
  }

  return {
    chainId,
    blockedReason,
    intro: HUB_INTRO,
    roleLine,
    noRole,
    rows,
    loans: loans.map((loan) => ({
      loanId: loan.loan_id,
      loanLabel: formatLoanLabel(loan.originator, loan.commodity),
      status: loan.onchain_status,
      links: loanLinks(loan.onchain_status),
    })),
    loading: lookups.isLoading,
  };
}

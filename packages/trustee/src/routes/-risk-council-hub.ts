// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useMemo } from "react";
import { useStellarWallet } from "@pipeline/wallet-connect";
import { useLoanBook, type LoanBookEntry } from "@/api/useLoanBook";
import { useRiskCouncilAccess } from "@/api/useRiskCouncil";
import { useSessionState } from "@/auth/sessionStore";
import {
  accessAction,
  formatReadyAt,
  riskCouncilRoleLine,
} from "@/lib/accessManagerAction";
import { ENV } from "@/lib/env";
import {
  useExecutedOperations,
  useScheduledOps,
  useServedOperationIds,
} from "@/lib/riskCouncilOps";
import {
  riskCouncilBlockedReason,
  stellarOnlyActionReason,
} from "@/lib/targetChains";
import { formatLoanLabel } from "./-risk-council-shared";
import { DEFAULT_NO_ROLE } from "./-risk-council-escalate";
import {
  callerText,
  mergePendingOps,
  pendingActionLabel,
  pendingArgRows,
  pendingOwner,
  PENDING_STATE_LABELS,
  usePruneExecuted,
  type PendingOpItem,
  type PendingOwner,
} from "./-risk-council-pending";

export const HUB_INTRO =
  "The Risk Council acts through the access manager. Declaring a default executes at once; every other Risk Council action waits 24 hours, and the Guardian or the Admin can cancel it during the wait.";
export const HUB_EMPTY = "No scheduled operations found.";
export const HUB_FOOTNOTE =
  "Inspector panel changes are not tied to a loan and are not listed here; open the Inspector panel to check one.";
export const HUB_NO_ROLE = "Risk Council actions belong to the Risk Council.";

export type HubRoute = PendingOwner | "inspectors";

export interface HubLink {
  label: string;
  route: HubRoute;
}

export interface ScheduledRow {
  key: string;
  loanLabel: string;
  action: string;
  args: string;
  scheduledBy: string;
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
  showInspectorsLink: boolean;
  intro: string;
  roleLine: string | null;
  rows: ScheduledRow[];
  loans: LoanIndexRow[];
  loading: boolean;
}

export function formatPendingArgs(
  item: PendingOpItem,
  chainId: number,
): string {
  const rows = pendingArgRows(item, chainId);
  return rows.length === 0
    ? "—"
    : rows.map((row) => `${row.label}: ${row.value}`).join(" · ");
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
  const loans = useMemo(
    () => (blockedReason ? [] : (loanBook.data?.loans ?? [])),
    [blockedReason, loanBook.data],
  );
  const access = useRiskCouncilAccess(chainId, null, "set_default");
  const sessionOps = useScheduledOps(chainId);
  const executed = useExecutedOperations(chainId);
  const everServed = useServedOperationIds(chainId);
  const { address } = useStellarWallet();

  const servedOps = useMemo(
    () => loans.flatMap((loan) => loan.pending_operations ?? []),
    [loans],
  );
  usePruneExecuted(chainId, servedOps, loanBook.dataUpdatedAt ?? 0);

  const canCall = access.data?.canCall;
  const noRole = canCall != null && !canCall.immediate && canCall.delay === 0;
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

  const nowSec = Date.now() / 1000;
  const items: PendingOpItem[] = loans
    .flatMap((loan) => {
      const loanId = Number(loan.loan_id);
      return Number.isInteger(loanId)
        ? mergePendingOps({
            served: loan.pending_operations ?? [],
            session: sessionOps,
            executed,
            everServed,
            chainId,
            loanId,
            nowSec,
          })
        : [];
    })
    .filter((item) => item.executed === null)
    .sort(
      (a, b) =>
        a.readyAt - b.readyAt || a.operationId.localeCompare(b.operationId),
    );

  const rows: ScheduledRow[] = items.map((item) => {
    const owner = pendingOwner(item.fn);
    return {
      key: item.key,
      loanLabel: item.loanId === null ? "—" : loanLabelFor(loans, item.loanId),
      action: pendingActionLabel(item),
      args: formatPendingArgs(item, chainId),
      scheduledBy: callerText(item, address, chainId),
      executableFrom: formatReadyAt(item.readyAt),
      state: PENDING_STATE_LABELS[item.state],
      link:
        owner === null || item.loanId === null
          ? null
          : { route: owner, loanId: String(item.loanId) },
    };
  });

  return {
    chainId,
    blockedReason,
    showInspectorsLink:
      blockedReason === null ||
      riskCouncilBlockedReason(chainId, "set_inspectors") === null,
    intro: HUB_INTRO,
    roleLine,
    rows,
    loans: loans.map((loan) => ({
      loanId: loan.loan_id,
      loanLabel: formatLoanLabel(loan.originator, loan.commodity),
      status: loan.onchain_status,
      links: loanLinks(loan.onchain_status),
    })),
    loading: loanBook.isLoading,
  };
}

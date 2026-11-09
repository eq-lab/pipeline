// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useState } from "react";
import { useLoanBook, type LoanBookEntry } from "@/api/useLoanBook";
import {
  useRiskCouncilAccess,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
  type RiskCouncilCall,
  type RiskCouncilLoanState,
} from "@/api/useRiskCouncil";
import {
  accessAction,
  formatDelayHours,
  NO_LONGER_SCHEDULED,
  riskCouncilErrorCopy,
  riskCouncilRoleLine,
  stageLabel,
  type AccessAction,
} from "@/lib/accessManagerAction";
import { findLoanEntry } from "@/lib/loanRoute";
import { useScheduledOp } from "@/lib/riskCouncilOps";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import { toUserError, type UserFacingError } from "@/utils/userError";
import { formatChainAmount } from "./-repayment-recovery";

export interface LabelValue {
  label: string;
  value: string;
}

export type PageState = "loading" | "error" | "not-found" | "ready";

export interface LoanBase {
  state: PageState;
  errorMessage: string | null;
  errorDetails: string | null;
  entry: LoanBookEntry | undefined;
  loanId: number | null;
  blockedReason: string | null;
  chainState: RiskCouncilLoanState | undefined;
  chainStatus: string | null;
}

export interface ActionView {
  action: AccessAction | null;
  roleLine: string;
  buttonLabel: string;
  disabled: boolean;
  notice: string | null;
  pending: boolean;
  stageText: string;
  error: UserFacingError | null;
  hash: string | null;
  noLongerScheduled: string | null;
  chip: string | null;
  run: () => void;
}

export interface ActionLabels {
  now: string;
  schedule: string;
  execute: string;
}

const LATENCY_GRACE_MS = 14_000;
const NOT_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  "Closed",
  "Approved",
]);

export function formatLoanLabel(
  originator: string | null | undefined,
  commodity: string | null | undefined,
): string {
  return `${originator ?? "—"} — ${commodity ?? "—"}`;
}

export function formatSignedChainAmount(raw: string, chainId: number): string {
  return raw.startsWith("-")
    ? `-${formatChainAmount(raw.slice(1), chainId)}`
    : formatChainAmount(raw, chainId);
}

export type ChainStateKey =
  | "status"
  | "outstanding"
  | "disbursed"
  | "repaid"
  | "writtenDown"
  | "pocket"
  | "closure";

const CHAIN_STATE_LABELS: Record<ChainStateKey, string> = {
  status: "Status (on chain)",
  outstanding: "Outstanding principal",
  disbursed: "Disbursed",
  repaid: "Principal repaid",
  writtenDown: "Written down",
  pocket: "Pocket opened",
  closure: "Closure reason",
};

export function chainStateRows(
  chainId: number,
  state: RiskCouncilLoanState | undefined,
  keys: ReadonlyArray<ChainStateKey>,
): LabelValue[] {
  const money = (raw: string | undefined) =>
    raw == null ? "—" : formatChainAmount(raw, chainId);
  const values: Record<ChainStateKey, string> = {
    status: state?.chain.status || "—",
    outstanding: money(state?.money.outstanding),
    disbursed: money(state?.money.disbursed),
    repaid: money(state?.money.repaid),
    writtenDown: money(state?.money.writtenDown),
    pocket: state == null ? "—" : state.chain.carvedOut ? "Yes" : "No",
    closure: state?.chain.closureReason || "—",
  };
  return keys.map((key) => ({
    label: CHAIN_STATE_LABELS[key],
    value: values[key],
  }));
}

export function amendEligibility(status: string | null): boolean {
  return status != null && !NOT_ELIGIBLE_STATUSES.has(status);
}

export function notAvailableNote(status: string | null): string | null {
  return status != null && NOT_ELIGIBLE_STATUSES.has(status)
    ? `Not available for a ${status} loan.`
    : null;
}

export function useRiskCouncilLoanBase(
  chainId: number,
  loanIdParam: string,
): LoanBase {
  const loanBook = useLoanBook();
  const entry = findLoanEntry(loanBook.data?.loans, chainId, loanIdParam);
  const parsed = Number(loanIdParam);
  const loanId = Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  const chainStateQuery = useRiskCouncilLoanState(chainId, loanId);

  const state: PageState = loanBook.isLoading
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
    entry,
    loanId,
    blockedReason: stellarOnlyActionReason(chainId),
    chainState: chainStateQuery.data,
    chainStatus: chainStateQuery.data?.chain.status || null,
  };
}

function chipFor(
  action: AccessAction | null,
  delay: number | undefined,
): string | null {
  switch (action) {
    case "execute-now":
      return "Risk Council · executes at once";
    case "schedule":
    case "execute-scheduled":
      return `Risk Council · ${formatDelayHours(delay ?? 0)} delay`;
    case "no-role":
      return "Risk Council only";
    default:
      return null;
  }
}

export function useRiskCouncilActionView({
  chainId,
  call,
  fn,
  noRoleCopy,
  labels,
  enabled,
  executeGate,
}: {
  chainId: number;
  call: RiskCouncilCall | null;
  fn: RiskCouncilCall["fn"];
  noRoleCopy: string;
  labels: ActionLabels;
  enabled: boolean;
  executeGate?: string | null;
}): ActionView {
  const blockedReason = stellarOnlyActionReason(chainId);
  const access = useRiskCouncilAccess(chainId, call, fn);
  const relay = useRiskCouncilRelay();
  const op = useScheduledOp(chainId, call);
  const [lastMode, setLastMode] = useState<"schedule" | "execute">("execute");

  const canCall = access.data?.canCall;
  const delayedWithoutCall =
    call === null && canCall != null && !canCall.immediate && canCall.delay > 0;
  const schedule = delayedWithoutCall
    ? { operationId: "", readyAt: 0 }
    : (access.data?.schedule ?? undefined);
  const action = accessAction(canCall, schedule);
  const mode =
    action === "execute-now" || action === "execute-scheduled"
      ? "execute"
      : action === "schedule"
        ? "schedule"
        : null;

  const gate = mode === "execute" ? (executeGate ?? null) : null;
  const disabled =
    blockedReason != null ||
    !enabled ||
    mode === null ||
    call === null ||
    gate !== null ||
    relay.isPending;

  const buttonLabel =
    action === "execute-now"
      ? labels.now
      : action === "execute-scheduled"
        ? labels.execute
        : labels.schedule;

  const accessError = access.error
    ? toUserError(access.error, "Failed to read this wallet's permissions.")
    : null;
  const relayError = relay.error ? mapRelayError(lastMode, relay.error) : null;

  const noLonger =
    op != null &&
    !op.executedHere &&
    action === "schedule" &&
    !delayedWithoutCall &&
    access.dataUpdatedAt - op.scheduledAt > LATENCY_GRACE_MS;

  return {
    action,
    roleLine:
      blockedReason ??
      riskCouncilRoleLine(
        action,
        canCall?.delay ?? null,
        access.data?.schedule?.readyAt ?? null,
        noRoleCopy,
      ),
    buttonLabel,
    disabled,
    notice: blockedReason ?? gate,
    pending: relay.isPending,
    stageText: relay.isPending ? stageLabel(relay.stage, "Working…") : "",
    error: relayError ?? accessError,
    hash: relay.hash,
    noLongerScheduled: noLonger ? NO_LONGER_SCHEDULED : null,
    chip: chipFor(action, canCall?.delay),
    run: () => {
      if (mode === null || call === null) return;
      setLastMode(mode);
      relay.mutateAsync({ mode, call, chainId }).catch(() => {});
    },
  };
}

function mapRelayError(
  mode: "schedule" | "execute",
  error: Error,
): UserFacingError {
  const mapped = toUserError(error, "The Risk Council action failed.");
  const copy = riskCouncilErrorCopy(mode, mapped.details);
  return copy ? { ...mapped, message: copy, isSpecific: true } : mapped;
}

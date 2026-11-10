// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useState } from "react";
import type {
  RiskCouncilCall,
  RiskCouncilClosureReason,
} from "@/api/useRiskCouncil";
import { usdInputToSacBaseUnits } from "@/utils/stellarSacUnits";
import { formatChainAmount } from "./-repayment-recovery";
import {
  chainStateRows,
  formatLoanLabel,
  useRiskCouncilActionView,
  useRiskCouncilLoanBase,
  type ActionView,
  type LabelValue,
  type PageState,
} from "./-risk-council-shared";

export const RESOLUTION_NO_ROLE =
  "Writing down, closing a defaulted loan and curing belong to the Risk Council.";
export const CLOSE_GATE = "Executable once the outstanding principal is zero.";
export const CURE_EFFECTS =
  "The loan returns to WatchList. The pocket stays open; later repayments still go to the pocket holders.";
export const NOT_IN_DEFAULT = "This loan is not in Default.";

export const CLOSURE_TABLE: ReadonlyArray<{
  reason: RiskCouncilClosureReason;
  label: string;
  who: string;
  delay: string;
}> = [
  {
    reason: "Default",
    label: "Default",
    who: "Risk Council only",
    delay: "24 hours",
  },
  {
    reason: "OtherWriteDown",
    label: "Other write-down",
    who: "Risk Council only",
    delay: "24 hours",
  },
];

export function closeExecuteGate(
  outstanding: string | null | undefined,
): string | null {
  return outstanding === "0" ? null : CLOSE_GATE;
}

export function writeDownPrefill(
  outstanding: string | null | undefined,
  chainId: number,
): string {
  return outstanding == null ? "" : formatChainAmount(outstanding, chainId);
}

export function buildWriteDownCall(
  loanId: number | null,
  amountInput: string,
): RiskCouncilCall | null {
  const amount = usdInputToSacBaseUnits(amountInput);
  if (loanId === null || amount === null) return null;
  return { fn: "write_down", loanId, amount };
}

export interface WriteDownView {
  amountInput: string;
  setAmountInput: (value: string) => void;
  action: ActionView;
}

export interface CloseView {
  reason: RiskCouncilClosureReason;
  setReason: (value: RiskCouncilClosureReason) => void;
  action: ActionView;
}

export interface RiskCouncilWritedownView {
  state: PageState;
  errorMessage: string | null;
  errorDetails: string | null;
  loanId: string;
  loan: string;
  chainState: LabelValue[];
  notInDefault: boolean;
  writeDown: WriteDownView;
  close: CloseView;
  cure: { effects: string; action: ActionView };
}

export function useRiskCouncilWritedown(
  chainId: number,
  loanIdParam: string,
): RiskCouncilWritedownView {
  const base = useRiskCouncilLoanBase(chainId, loanIdParam);
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [reason, setReason] = useState<RiskCouncilClosureReason>("Default");

  const inDefault = base.chainStatus === "Default";
  const outstanding = base.chainState?.money.outstanding;
  const amountInput = amountEdit ?? writeDownPrefill(outstanding, chainId);

  const writeDown = useRiskCouncilActionView({
    chainId,
    call: buildWriteDownCall(base.loanId, amountInput),
    fn: "write_down",
    noRoleCopy: RESOLUTION_NO_ROLE,
    labels: {
      now: "Write down",
      schedule: "Schedule write-down",
      execute: "Execute write-down",
    },
    enabled: inDefault,
  });
  const close = useRiskCouncilActionView({
    chainId,
    call:
      base.loanId === null
        ? null
        : { fn: "close_defaulted", loanId: base.loanId, reason },
    fn: "close_defaulted",
    noRoleCopy: RESOLUTION_NO_ROLE,
    labels: {
      now: "Close defaulted loan",
      schedule: "Schedule close",
      execute: "Execute close",
    },
    enabled: inDefault,
    executeGate: closeExecuteGate(outstanding),
  });
  const cure = useRiskCouncilActionView({
    chainId,
    call: base.loanId === null ? null : { fn: "cure", loanId: base.loanId },
    fn: "cure",
    noRoleCopy: RESOLUTION_NO_ROLE,
    labels: { now: "Cure", schedule: "Schedule cure", execute: "Execute cure" },
    enabled: inDefault,
  });

  return {
    state: base.state,
    errorMessage: base.errorMessage,
    errorDetails: base.errorDetails,
    loanId: loanIdParam,
    loan: formatLoanLabel(base.entry?.originator, base.entry?.commodity),
    chainState: chainStateRows(chainId, base.chainState, [
      "status",
      "outstanding",
      "disbursed",
      "repaid",
      "writtenDown",
      "pocket",
      "closure",
    ]),
    notInDefault: base.chainStatus != null && !inDefault,
    writeDown: {
      amountInput,
      setAmountInput: setAmountEdit,
      action: writeDown,
    },
    close: { reason, setReason, action: close },
    cure: { effects: CURE_EFFECTS, action: cure },
  };
}

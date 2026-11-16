// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { vi } from "vitest";
import type { LoanBookEntry, LoanBookResponse } from "@/api/useLoanBook";
import type { PendingOperation } from "@/api/pendingOperations";
import type { UseLoanSecurityResult } from "@/api/useLoanSecurity";
import type {
  RiskCouncilAccess,
  RiskCouncilLoanState,
} from "@/api/useRiskCouncil";

export const STELLAR = 99_000_001;
export const OTHER_CHAIN = 1;
export const READY_AT = 1_800_000_000;

export function loanEntry(
  overrides: Partial<LoanBookEntry> = {},
): LoanBookEntry {
  return {
    loan_id: "4471",
    chain_id: STELLAR,
    originator: "Delta Commodities",
    borrower: "b1",
    commodity: "Coffee",
    principal: "2300000.000000",
    senior_outstanding: "1840000.000000",
    original_senior_tranche: "1840000.000000",
    maturity: 1_782_777_600,
    next_payment_timestamp: 1_782_777_600,
    days_overdue: null,
    duration_days: 88,
    rate: "0.130000",
    protection: null,
    status: "WatchList",
    onchain_status: "WatchList",
    documents: [],
    repaid_to_date: "0.000000",
    disbursed: true,
    days_on_watchlist: 12,
    watchlist_entered_at: null,
    ...overrides,
  };
}

export function securityResult(
  overrides: Partial<UseLoanSecurityResult> = {},
): UseLoanSecurityResult {
  return {
    data: {
      terms: { advance_ratio_bps: 8000, margin_call_ratio_bps: 8500 },
      valuation: {
        value: "2106000.000000",
        debt: "1710000.000000",
        ltv_bps: 8123,
        price_stale: false,
      },
      margin_call: { open: false },
    },
    isLoading: false,
    error: null,
    notConfigured: false,
    dataUpdatedAt: 0,
    refetch: () => {},
    ...overrides,
  };
}

export function loanBook(loans: LoanBookEntry[]): LoanBookResponse {
  return {
    summary: {
      total_deployed: "0.000000",
      total_collateral: null,
      senior_debt_coverage: null,
      avg_yield: null,
      avg_duration_days: null,
      deployed_senior: "0.000000",
      weighted_rate: null,
      weighted_tenor_days: null,
      at_risk_wl_and_default_senior: "0.000000",
      at_risk_wl_and_default_pct: "0.0210",
      top_concentration: { commodity: "Coffee", share: "0.0390" },
    },
    loans,
  };
}

export function loanBookResult(loans: LoanBookEntry[]) {
  return {
    data: loanBook(loans),
    isLoading: false,
    error: null,
    refetch: () => {},
  };
}

export function loanState(
  overrides: {
    status?: string;
    closureReason?: string;
    currentRate?: number;
    currentMaturity?: number;
    interestAdjustment?: string;
    carvedOut?: boolean;
    outstanding?: string;
    disbursed?: string;
    repaid?: string;
    writtenDown?: string;
    accruedInterest?: string;
  } = {},
): RiskCouncilLoanState {
  return {
    chain: {
      status: overrides.status ?? "WatchList",
      closureReason: overrides.closureReason ?? "None",
      currentRate: overrides.currentRate ?? 145_000,
      currentMaturity: overrides.currentMaturity ?? 1_797_292_800,
      interestAdjustment: overrides.interestAdjustment ?? "0",
      writtenDown: overrides.writtenDown ?? "0",
      carvedOut: overrides.carvedOut ?? false,
      metadataUri: "ipfs://cur",
    },
    money: {
      accruedInterest: overrides.accruedInterest ?? "5000000",
      carvedOut: overrides.carvedOut ?? false,
      disbursed: overrides.disbursed ?? "18400000000000",
      outstanding: overrides.outstanding ?? "18400000000000",
      repaid: overrides.repaid ?? "100000000",
      writtenDown: overrides.writtenDown ?? "0",
    },
  };
}

export function accessResult(access: RiskCouncilAccess | undefined) {
  return {
    data: access,
    error: null,
    isLoading: access === undefined,
    dataUpdatedAt: Date.now(),
  };
}

export const IMMEDIATE: RiskCouncilAccess = {
  canCall: { immediate: true, delay: 0 },
  schedule: null,
};
export const NO_ROLE: RiskCouncilAccess = {
  canCall: { immediate: false, delay: 0 },
  schedule: null,
};
export const DELAYED: RiskCouncilAccess = {
  canCall: { immediate: false, delay: 86_400 },
  schedule: { operationId: "x", readyAt: 0 },
};
export const SCHEDULED: RiskCouncilAccess = {
  canCall: { immediate: false, delay: 86_400 },
  schedule: { operationId: "x", readyAt: READY_AT },
};

export function relayResult(
  overrides: Partial<{
    isPending: boolean;
    stage: string | null;
    error: Error | null;
    hash: string | null;
  }> = {},
) {
  return {
    mutateAsync: vi.fn().mockResolvedValue({ hash: "H" }),
    isPending: false,
    isSuccess: false,
    error: null,
    hash: null,
    stage: null,
    reset: vi.fn(),
    ...overrides,
  };
}

export function pendingExecuteResult(error: Error | null = null) {
  return {
    mutateAsync: vi.fn().mockResolvedValue({ hash: "EH" }),
    isPending: false,
    error,
    hash: null,
    stage: null,
    reset: vi.fn(),
  };
}

export const SECURITY_REGISTRY = "CSECURITYREGISTRY1234567890";
export const LOAN_REGISTRY = "CLOANREGISTRY1234567890XYZ";
export const MINTER = "CMINTER1234567890ABCDEFGH";
export const SCHEDULER = "GSCHEDULERADDRESS1234567890ABCD";
export const OPERATION_ID = "ab".repeat(32);
export const HASH_A = "cd".repeat(32);
export const HASH_B = "ef".repeat(32);
export const SECONDS_PER_WEEK = 604_800;

export const SET_TERMS_ARGS = [
  7,
  {
    advance_ratio_bps: 7000,
    attestation_interval: "2592000",
    cure_period: "604800",
    default_rate: 20000,
    grace_period: "259200",
    grade_tolerance_bps: 25,
    inspection_interval: "0",
    margin_call_at: "0",
    margin_call_ratio_bps: 8250,
    payment_term: ["Lc"],
    price_stale_after: "86400",
    tolerance_bps: 50,
  },
];

function isoAt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

export function pendingOp(
  overrides: Partial<PendingOperation> = {},
): PendingOperation {
  return {
    operation_id: OPERATION_ID,
    nonce: 1,
    caller: SCHEDULER,
    target: SECURITY_REGISTRY,
    target_kind: "security_registry",
    function: "set_terms",
    args_xdr: "AAAAEAAAAAA=",
    args: SET_TERMS_ARGS,
    ready_at: isoAt(READY_AT),
    expires_at: isoAt(READY_AT + SECONDS_PER_WEEK),
    state: "ready",
    ...overrides,
  };
}

export const LOAN_REGISTRY_ARGS = {
  set_default: [7],
  cure: [7],
  amend_economics: [7, 145_000, "1816128000"],
  adjust_interest: [7, "-1000000", "ab".repeat(32)],
  write_down: [7, "5000000"],
  close_defaulted: [7, ["OtherWriteDown"]],
} as const;

export function loanRegistryOp(
  fn: keyof typeof LOAN_REGISTRY_ARGS,
  overrides: Partial<PendingOperation> = {},
): PendingOperation {
  return pendingOp({
    operation_id: fnOperationId(fn),
    target: LOAN_REGISTRY,
    target_kind: "loan_registry",
    function: fn,
    args: LOAN_REGISTRY_ARGS[fn],
    ...overrides,
  });
}

export function minterOp(
  overrides: Partial<PendingOperation> = {},
): PendingOperation {
  return pendingOp({
    operation_id: fnOperationId("reverse_repay"),
    target: MINTER,
    target_kind: "minter",
    function: "reverse_repay",
    args: [7, 2, "cd".repeat(32)],
    ...overrides,
  });
}

const OPERATION_FNS = [
  ...Object.keys(LOAN_REGISTRY_ARGS),
  "reverse_repay",
] as const;

function fnOperationId(fn: string): string {
  const index = OPERATION_FNS.indexOf(fn as (typeof OPERATION_FNS)[number]);
  return (0x50 + index).toString(16).repeat(32);
}

// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { vi } from "vitest";
import type { LoanBookEntry, LoanBookResponse } from "@/api/useLoanBook";
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
    spot_price: "4500",
    spot_change_7d: "-0.18",
    collateral: "2106000.000000",
    ltv: null,
    ccr_bps: 11_400,
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

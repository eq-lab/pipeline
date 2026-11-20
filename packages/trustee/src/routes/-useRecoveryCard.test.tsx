// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  EVM,
  OTHER_CHAIN,
  STELLAR,
  loanBookResult,
  loanEntry,
} from "./-riskCouncilFixtures";

const state = vi.hoisted(() => ({
  loanBook: { data: undefined as unknown },
  candidates: { data: undefined as unknown },
  financials: { data: undefined as unknown },
}));

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: () => state.loanBook }));
vi.mock("@/api/useLoanFinancials", () => ({
  useLoanFinancials: () => state.financials,
}));
vi.mock("@/api/useRepaymentRecovery", () => ({
  RECOVERY_STATUSES: new Set(["Performing", "WatchList", "Default"]),
  useRecoveryCandidates: () => state.candidates,
  useReverseRepayAccess: vi.fn(),
  useScheduleReverseRepay: vi.fn(),
  useExecuteReverseRepay: vi.fn(),
}));
vi.mock("@/api/useRecordPayment", () => ({ useRecordPayment: vi.fn() }));
vi.mock("@/api/useAuditLog", () => ({ useAuditLog: vi.fn() }));
vi.mock("@/api/useLoanWaterfall", () => ({ useLoanWaterfall: vi.fn() }));

import { useRecoveryCard } from "./-useRepaymentRecoveryDialog";

function serve(chainId: number) {
  state.loanBook = loanBookResult([
    loanEntry({
      loan_id: "7",
      chain_id: chainId,
      onchain_status: "Performing",
      senior_outstanding: "5.000000",
    }),
  ]);
}

beforeEach(() => {
  state.candidates = { data: { rows: [], latestReversed: false } };
  state.financials = { data: { offtaker_outstanding: "0.000000" } };
});

describe("useRecoveryCard", () => {
  it("is eligible on the Stellar chain", () => {
    serve(STELLAR);
    const { result } = renderHook(() => useRecoveryCard(STELLAR, "7"));
    expect(result.current.state).toBe("eligible");
    expect(result.current.blockedReason).toBeNull();
  });

  it("is eligible, not blocked, on the configured EVM chain", () => {
    serve(EVM);
    const { result } = renderHook(() => useRecoveryCard(EVM, "7"));
    expect(result.current.state).toBe("eligible");
    expect(result.current.blockedReason).toBeNull();
  });

  it("is blocked with the Stellar-only reason on an unknown EVM chain id", () => {
    serve(OTHER_CHAIN);
    const { result } = renderHook(() => useRecoveryCard(OTHER_CHAIN, "7"));
    expect(result.current.state).toBe("blocked-evm");
    expect(result.current.blockedReason).toMatch(/Stellar only/);
  });

  it("shows awaiting-corrected-repayment on EVM when the latest repayment is reversed", () => {
    serve(EVM);
    state.candidates = { data: { rows: [], latestReversed: true } };
    const { result } = renderHook(() => useRecoveryCard(EVM, "7"));
    expect(result.current.state).toBe("awaiting-corrected-repayment");
  });
});

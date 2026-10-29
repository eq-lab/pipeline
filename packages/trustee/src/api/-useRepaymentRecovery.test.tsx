// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useExecuteReverseRepay,
  useRecoveryCandidates,
  useReverseRepayAccess,
  useScheduleReverseRepay,
} from "./useRepaymentRecovery";

const mocks = vi.hoisted(() => ({
  scheduleReverseRepay: vi.fn(),
  executeReverseRepay: vi.fn(),
  readCanCall: vi.fn(),
  readIsRepaymentReversed: vi.fn(),
  readMinterRepayment: vi.fn(),
  readNextRepaymentId: vi.fn(),
  readRepaymentData: vi.fn(),
  readReverseRepaySchedule: vi.fn(),
  reverseRepayRefHash: vi.fn(),
  sign: vi.fn(),
  wallet: { address: "GRC" as string | null, isConnected: true },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  scheduleReverseRepay: mocks.scheduleReverseRepay,
  executeReverseRepay: mocks.executeReverseRepay,
  readCanCall: mocks.readCanCall,
  readIsRepaymentReversed: mocks.readIsRepaymentReversed,
  readMinterRepayment: mocks.readMinterRepayment,
  readNextRepaymentId: mocks.readNextRepaymentId,
  readRepaymentData: mocks.readRepaymentData,
  readReverseRepaySchedule: mocks.readReverseRepaySchedule,
  reverseRepayRefHash: mocks.reverseRepayRefHash,
  useStellarWallet: () => ({
    address: mocks.wallet.address,
    isConnected: mocks.wallet.isConnected,
    signTransaction: mocks.sign,
  }),
}));

const envMock = vi.hoisted(() => ({
  STELLAR_CHAIN_ID: 99_000_001,
  EVM_CHAIN_ID: 560_048,
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_LOAN_REGISTRY_ID: "CREGISTRY",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CAM",
  STELLAR_YIELD_MINTER_ID: "CMINTER",
}));
vi.mock("@/lib/env", () => ({ ENV: envMock }));

const STELLAR = 99_000_001;
const EVM = 560_048;
const REF = "cd".repeat(32);
let queryClient: QueryClient;

function makeWrapper() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function keys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(
    (c) => (c[0] as { queryKey: unknown[] }).queryKey[0],
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => {
    if (typeof m === "function") (m as ReturnType<typeof vi.fn>).mockReset();
  });
  mocks.wallet.address = "GRC";
  mocks.wallet.isConnected = true;
  mocks.reverseRepayRefHash.mockResolvedValue(REF);
  mocks.scheduleReverseRepay.mockResolvedValue({ hash: "sched" });
  mocks.executeReverseRepay.mockResolvedValue({ hash: "exec" });
  envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
  envMock.STELLAR_YIELD_MINTER_ID = "CMINTER";
  envMock.STELLAR_LOAN_REGISTRY_ID = "CREGISTRY";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useReverseRepay mutations", () => {
  it("passes the derived refHash to schedule and to execute", async () => {
    const schedule = renderHook(() => useScheduleReverseRepay(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await schedule.result.current.mutateAsync({ loanId: 7, repaymentId: 1 });
    });
    const execute = renderHook(() => useExecuteReverseRepay(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await execute.result.current.mutateAsync({ loanId: 7, repaymentId: 1 });
    });
    expect(mocks.reverseRepayRefHash).toHaveBeenCalledWith({
      minterId: "CMINTER",
      loanId: 7,
      repaymentId: 1,
    });
    const expected = {
      accessManagerId: "CAM",
      minterId: "CMINTER",
      caller: "GRC",
      loanId: 7,
      repaymentId: 1,
      refHash: REF,
    };
    expect(mocks.scheduleReverseRepay).toHaveBeenCalledWith(
      expect.objectContaining(expected),
    );
    expect(mocks.executeReverseRepay).toHaveBeenCalledWith(
      expect.objectContaining(expected),
    );
    expect(mocks.executeReverseRepay).toHaveBeenCalledTimes(1);
  });

  it("rejects before any RPC call when not configured or not connected", async () => {
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    const a = renderHook(() => useExecuteReverseRepay(), {
      wrapper: makeWrapper(),
    });
    await expect(
      a.result.current.mutateAsync({ loanId: 7, repaymentId: 1 }),
    ).rejects.toThrow(/not configured for this environment/);

    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
    mocks.wallet.isConnected = false;
    const b = renderHook(() => useExecuteReverseRepay(), {
      wrapper: makeWrapper(),
    });
    await expect(
      b.result.current.mutateAsync({ loanId: 7, repaymentId: 1 }),
    ).rejects.toThrow(/wallet not connected/);
    expect(mocks.executeReverseRepay).not.toHaveBeenCalled();
  });

  it("invalidates the recovery, loan and audit queries on success, then at 5 s and 15 s", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useExecuteReverseRepay(), {
      wrapper: makeWrapper(),
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ loanId: 7, repaymentId: 1 });
    });
    const expected = [
      "repayment-recovery",
      "repayment-recovery-access",
      "loan-book",
      "loan-financials",
      "loan-waterfall",
      "audit-log",
    ];
    expect(keys(spy)).toEqual(expected);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(keys(spy)).toEqual([...expected, ...expected]);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(keys(spy)).toHaveLength(expected.length * 3);
  });

  it("exposes the stage reported by the relay", async () => {
    mocks.executeReverseRepay.mockImplementation(
      async ({ onStageChange }: { onStageChange: (s: string) => void }) => {
        onStageChange("confirming");
        return { hash: "exec" };
      },
    );
    const { result } = renderHook(() => useExecuteReverseRepay(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({ loanId: 7, repaymentId: 1 });
    });
    expect(result.current.stage).toBe("confirming");
  });
});

describe("useRecoveryCandidates", () => {
  beforeEach(() => {
    mocks.readNextRepaymentId.mockResolvedValue(2);
    mocks.readRepaymentData.mockImplementation(
      async ({ repaymentId }: { repaymentId: number }) => ({
        offtaker_received: String(repaymentId),
      }),
    );
    mocks.readIsRepaymentReversed.mockImplementation(
      async ({ repaymentId }: { repaymentId: number }) => repaymentId === 1,
    );
    mocks.readMinterRepayment.mockResolvedValue({ cash: "1" });
  });

  it("reads every repayment and reports whether the latest is reversed", async () => {
    const { result } = renderHook(
      () => useRecoveryCandidates(STELLAR, "7", "Performing"),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.rows.map((r) => r.repaymentId)).toEqual([0, 1]);
    expect(result.current.data!.rows[1]!.reversed).toBe(true);
    expect(result.current.data!.latestReversed).toBe(true);
  });

  it("stays disabled for an EVM chain and for out-of-range statuses", () => {
    const evm = renderHook(
      () => useRecoveryCandidates(EVM, "7", "Performing"),
      { wrapper: makeWrapper() },
    );
    const closed = renderHook(
      () => useRecoveryCandidates(STELLAR, "7", "Closed"),
      { wrapper: makeWrapper() },
    );
    expect(evm.result.current.fetchStatus).toBe("idle");
    expect(closed.result.current.fetchStatus).toBe("idle");
    expect(mocks.readNextRepaymentId).not.toHaveBeenCalled();
  });
});

describe("useReverseRepayAccess", () => {
  it("reads can_call for reverse_repay and repay, skipping the schedule on the immediate path", async () => {
    mocks.readCanCall.mockImplementation(async ({ fn }: { fn: string }) =>
      fn === "reverse_repay"
        ? { immediate: true, delay: 0 }
        : { immediate: false, delay: 0 },
    );
    const { result } = renderHook(() => useReverseRepayAccess(7, 1, true), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      canReverse: { immediate: true, delay: 0 },
      canRepay: { immediate: false, delay: 0 },
      schedule: null,
    });
    expect(mocks.readReverseRepaySchedule).not.toHaveBeenCalled();
  });

  it("reads the operation schedule on the delayed path", async () => {
    mocks.readCanCall.mockResolvedValue({ immediate: false, delay: 86400 });
    mocks.readReverseRepaySchedule.mockResolvedValue({
      operationId: "ab",
      readyAt: 1_800_000_000,
    });
    const { result } = renderHook(() => useReverseRepayAccess(7, 1, true), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.schedule).toEqual({
      operationId: "ab",
      readyAt: 1_800_000_000,
    });
    expect(mocks.readReverseRepaySchedule).toHaveBeenCalledWith(
      expect.objectContaining({ caller: "GRC", refHash: REF, loanId: 7 }),
    );
  });

  it("stays disabled without a wallet or a selected repayment", () => {
    mocks.wallet.address = null;
    const a = renderHook(() => useReverseRepayAccess(7, 1, true), {
      wrapper: makeWrapper(),
    });
    const b = renderHook(() => useReverseRepayAccess(7, null, true), {
      wrapper: makeWrapper(),
    });
    expect(a.result.current.fetchStatus).toBe("idle");
    expect(b.result.current.fetchStatus).toBe("idle");
    expect(mocks.readCanCall).not.toHaveBeenCalled();
  });
});

// spec: docs/frontend/trustee-flows.md#close-loan-gating--the-close-checklist-1090-supersedes-the-884-gate
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRecordPayment } from "./useRecordPayment";

const recordPaymentMock = vi.fn();
const signTransactionMock = vi.fn();

vi.mock("@pipeline/wallet-connect", () => ({
  recordPayment: (...args: unknown[]) => recordPaymentMock(...args),
  useStellarWallet: () => ({
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  }),
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_LOAN_REGISTRY_ID: "CREGISTRY",
    STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CEXECUTOR",
  },
}));

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

const INPUT = {
  loanId: 4488,
  repayment: {} as never,
};

function keys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(
    (c) => (c[0] as { queryKey: unknown[] }).queryKey[0],
  );
}

beforeEach(() => {
  recordPaymentMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useRecordPayment invalidation", () => {
  it("invalidates loan-book, financials and waterfall immediately on success", async () => {
    recordPaymentMock.mockResolvedValue({ hash: "abc" });
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });
    expect(keys(spy)).toEqual([
      "loan-book",
      "loan-financials",
      "loan-waterfall",
    ]);
  });

  it("re-invalidates loan-book and financials at 5 s and 15 s", async () => {
    vi.useFakeTimers();
    recordPaymentMock.mockResolvedValue({ hash: "abc" });
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });
    spy.mockClear();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(keys(spy)).toEqual(["loan-book", "loan-financials"]);
    spy.mockClear();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(keys(spy)).toEqual(["loan-book", "loan-financials"]);
  });

  it("invalidates nothing on failure", async () => {
    vi.useFakeTimers();
    recordPaymentMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(INPUT).catch(() => {});
    });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

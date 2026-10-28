// spec: docs/frontend/trustee-flows.md#close-loan-gating--the-close-checklist-1090-supersedes-the-884-gate
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRecordPayment } from "./useRecordPayment";

const repayMock = vi.fn();
const readNextRepaymentIdMock = vi.fn();
const repaymentRefHashMock = vi.fn();
const signTransactionMock = vi.fn();

vi.mock("@pipeline/wallet-connect", () => ({
  repay: (...args: unknown[]) => repayMock(...args),
  readNextRepaymentId: (...args: unknown[]) => readNextRepaymentIdMock(...args),
  repaymentRefHash: (...args: unknown[]) => repaymentRefHashMock(...args),
  useStellarWallet: () => ({
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  }),
}));

const envMock = vi.hoisted(() => ({
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_LOAN_REGISTRY_ID: "CREGISTRY",
  STELLAR_YIELD_MINTER_ID: "CMINTER",
}));

vi.mock("@/lib/env", () => ({ ENV: envMock }));

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
  repayment: { offtaker_received: "100" } as never,
  valueDate: 1_793_059_200,
};

function keys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(
    (c) => (c[0] as { queryKey: unknown[] }).queryKey[0],
  );
}

beforeEach(() => {
  repayMock.mockReset();
  readNextRepaymentIdMock.mockReset().mockResolvedValue(3);
  repaymentRefHashMock.mockReset().mockResolvedValue("ab".repeat(32));
  envMock.STELLAR_YIELD_MINTER_ID = "CMINTER";
  envMock.STELLAR_LOAN_REGISTRY_ID = "CREGISTRY";
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useRecordPayment invalidation", () => {
  it("invalidates loan-book, financials and waterfall immediately on success", async () => {
    repayMock.mockResolvedValue({ hash: "abc" });
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
    repayMock.mockResolvedValue({ hash: "abc" });
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
    repayMock.mockRejectedValue(new Error("boom"));
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

describe("useRecordPayment repay call", () => {
  it("signs Minter.repay with the derived ref hash, value date and sale id 0", async () => {
    repayMock.mockResolvedValue({ hash: "abc", repaymentId: 3 });
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });
    expect(readNextRepaymentIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ registryId: "CREGISTRY", loanId: 4488 }),
    );
    expect(repaymentRefHashMock).toHaveBeenCalledWith({
      registryId: "CREGISTRY",
      loanId: 4488,
      nextRepaymentId: 3,
    });
    expect(repayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        caller: "GCALLER0000000000000000000000000000000000000000000000000",
        loanId: 4488,
        repayment: INPUT.repayment,
        valueDate: 1_793_059_200,
        refHash: "ab".repeat(32),
        saleId: 0,
        signTransaction: signTransactionMock,
      }),
    );
  });

  it.each(["STELLAR_YIELD_MINTER_ID", "STELLAR_LOAN_REGISTRY_ID"] as const)(
    "throws the not-configured error when %s is empty",
    async (key) => {
      envMock[key] = "";
      const { result } = renderHook(() => useRecordPayment(), {
        wrapper: makeWrapper(),
      });
      await act(async () => {
        await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
          /not configured for this environment/,
        );
      });
      expect(repayMock).not.toHaveBeenCalled();
    },
  );
});

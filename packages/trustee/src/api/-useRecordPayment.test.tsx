// spec: docs/frontend/trustee-flows.md#close-loan-gating--the-close-checklist-1090-supersedes-the-884-gate
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRecordPayment } from "./useRecordPayment";

const repayMock = vi.fn();
const readNextRepaymentIdMock = vi.fn();
const repaymentRefHashMock = vi.fn();
const repayEvmLoanMock = vi.fn();
const readEvmNextRepaymentIdMock = vi.fn();
const evmRepaymentRefHashMock = vi.fn();
const signTransactionMock = vi.fn();
const evmWallet = vi.hoisted(() => ({
  state: {
    address: "0x00000000000000000000000000000000000000c1" as string,
    isConnected: true,
  },
}));
const STELLAR_CHAIN = 1000;
const EVM_CHAIN = 560048;

vi.mock("@pipeline/wallet-connect", () => ({
  repay: (...args: unknown[]) => repayMock(...args),
  readNextRepaymentId: (...args: unknown[]) => readNextRepaymentIdMock(...args),
  repaymentRefHash: (...args: unknown[]) => repaymentRefHashMock(...args),
  repayEvmLoan: (...args: unknown[]) => repayEvmLoanMock(...args),
  readEvmNextRepaymentId: (...args: unknown[]) =>
    readEvmNextRepaymentIdMock(...args),
  evmRepaymentRefHash: (...args: unknown[]) => evmRepaymentRefHashMock(...args),
  useEvmWallet: () => evmWallet.state,
  useStellarWallet: () => ({
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  }),
}));

const envMock = vi.hoisted(() => ({
  STELLAR_CHAIN_ID: 1000,
  EVM_CHAIN_ID: 560048,
  EVM_MINTER_ADDRESS: "0x00000000000000000000000000000000000000e1",
  EVM_LOAN_REGISTRY_ADDRESS: "0x00000000000000000000000000000000000000b1",
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
  chainId: STELLAR_CHAIN as number | undefined,
};
const EVM_INPUT = { ...INPUT, chainId: EVM_CHAIN };

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
  envMock.EVM_MINTER_ADDRESS = "0x00000000000000000000000000000000000000e1";
  envMock.EVM_LOAN_REGISTRY_ADDRESS =
    "0x00000000000000000000000000000000000000b1";
  evmWallet.state = {
    address: "0x00000000000000000000000000000000000000c1",
    isConnected: true,
  };
  repayEvmLoanMock.mockReset();
  readEvmNextRepaymentIdMock.mockReset().mockResolvedValue(5);
  evmRepaymentRefHashMock.mockReset().mockResolvedValue(`0x${"cd".repeat(32)}`);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function fakeRelayTimers() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
}

describe("useRecordPayment invalidation", () => {
  it("invalidates loan-book, financials and waterfall immediately on success", async () => {
    fakeRelayTimers();
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
      "loan-security",
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
    expect(keys(spy)).toEqual([
      "loan-book",
      "loan-financials",
      "loan-security",
    ]);
    spy.mockClear();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(keys(spy)).toEqual([
      "loan-book",
      "loan-financials",
      "loan-security",
    ]);
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
    fakeRelayTimers();
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

describe("useRecordPayment (EVM arm)", () => {
  it("reads the next repayment id, derives the ref hash, then repays directly", async () => {
    fakeRelayTimers();
    repayEvmLoanMock.mockResolvedValue({ hash: "0xevm", repaymentId: 5 });
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    let outcome: { hash: string; repaymentId?: number | null } | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync(EVM_INPUT);
    });
    expect(outcome).toEqual({ hash: "0xevm", repaymentId: 5 });
    expect(readEvmNextRepaymentIdMock).toHaveBeenCalledWith({
      registry: envMock.EVM_LOAN_REGISTRY_ADDRESS,
      loanId: 4488,
    });
    expect(evmRepaymentRefHashMock).toHaveBeenCalledWith({
      registry: envMock.EVM_LOAN_REGISTRY_ADDRESS,
      loanId: 4488,
      nextRepaymentId: 5,
    });
    expect(repayEvmLoanMock).toHaveBeenCalledWith({
      minter: envMock.EVM_MINTER_ADDRESS,
      caller: "0x00000000000000000000000000000000000000c1",
      chainId: EVM_CHAIN,
      loanId: 4488,
      repayment: INPUT.repayment,
      valueDate: 1_793_059_200,
      refHash: `0x${"cd".repeat(32)}`,
      saleId: 0,
      onStageChange: expect.any(Function),
    });
    expect(repayMock).not.toHaveBeenCalled();
  });

  it("invalidates like the Stellar arm", async () => {
    fakeRelayTimers();
    repayEvmLoanMock.mockResolvedValue({ hash: "0xevm", repaymentId: 0 });
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(EVM_INPUT);
    });
    expect(keys(spy)).toEqual([
      "loan-book",
      "loan-financials",
      "loan-security",
      "loan-waterfall",
    ]);
  });

  it.each(["EVM_MINTER_ADDRESS", "EVM_LOAN_REGISTRY_ADDRESS"] as const)(
    "throws the not-configured error when %s is empty",
    async (key) => {
      envMock[key] = "";
      const { result } = renderHook(() => useRecordPayment(), {
        wrapper: makeWrapper(),
      });
      await act(async () => {
        await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
          "On-chain payment recording is not configured for this environment.",
        );
      });
      expect(readEvmNextRepaymentIdMock).not.toHaveBeenCalled();
      expect(repayEvmLoanMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a disconnected EVM wallet before any read", async () => {
    evmWallet.state = { address: "", isConnected: false };
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
        "EVM wallet not connected.",
      );
    });
    expect(readEvmNextRepaymentIdMock).not.toHaveBeenCalled();
    expect(repayEvmLoanMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown chain with the Stellar-only copy", async () => {
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...INPUT, chainId: 1234 }),
      ).rejects.toThrow(/Stellar only/);
    });
    expect(repayEvmLoanMock).not.toHaveBeenCalled();
    expect(repayMock).not.toHaveBeenCalled();
  });

  it("stays on the Stellar arm for a legacy row without a chain id", async () => {
    fakeRelayTimers();
    repayMock.mockResolvedValue({ hash: "abc" });
    const { result } = renderHook(() => useRecordPayment(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({ ...INPUT, chainId: undefined });
    });
    expect(repayMock).toHaveBeenCalledTimes(1);
    expect(repayEvmLoanMock).not.toHaveBeenCalled();
  });
});

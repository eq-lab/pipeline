// spec: docs/frontend/trustee-flows.md#close-loan-gating-884-resolved-open-questions-13
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCloseLoan } from "./useCloseLoan";

const hoisted = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const closeLoanMock = vi.fn();
const closeEvmLoanMock = vi.fn();
const signTransactionMock = vi.fn();
const STELLAR_CHAIN = 1000;
const EVM_CHAIN = 560048;
const EVM_ADDRESS = "0x00000000000000000000000000000000000000c1";
let stellarWalletState = {
  address: "GCALLER",
  isConnected: true,
  signTransaction: signTransactionMock,
};
let evmWalletState = { address: EVM_ADDRESS, isConnected: true };

vi.mock("@pipeline/wallet-connect", () => ({
  closeLoan: (...args: unknown[]) => closeLoanMock(...args),
  closeEvmLoan: (...args: unknown[]) => closeEvmLoanMock(...args),
  useStellarWallet: () => stellarWalletState,
  useEvmWallet: () => evmWalletState,
}));

const ENV_CONFIGURED = {
  STELLAR_CHAIN_ID: STELLAR_CHAIN,
  EVM_CHAIN_ID: EVM_CHAIN,
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_LOAN_REGISTRY_ID: "CREGISTRY",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CEXECUTOR",
  EVM_LOAN_REGISTRY_ADDRESS: "0x00000000000000000000000000000000000000b1",
  EVM_ACCESS_MANAGER_ADDRESS: "0x00000000000000000000000000000000000000a1",
};
hoisted.env = { ...ENV_CONFIGURED };

vi.mock("@/lib/env", () => ({
  get ENV() {
    return hoisted.env;
  },
}));

let queryClient: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const INPUT = {
  loanId: 7,
  reason: "EarlyRepayment",
  chainId: STELLAR_CHAIN as number | undefined,
};
const EVM_INPUT = { ...INPUT, chainId: EVM_CHAIN };

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  hoisted.env = { ...ENV_CONFIGURED };
  stellarWalletState = {
    address: "GCALLER",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
  evmWalletState = { address: EVM_ADDRESS, isConnected: true };
  closeLoanMock.mockReset();
  closeEvmLoanMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useCloseLoan (Stellar arm)", () => {
  it("threads env, wallet and reason through to closeLoan", async () => {
    closeLoanMock.mockResolvedValue({ hash: "abc" });
    const { result } = renderHook(() => useCloseLoan(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });
    expect(closeLoanMock.mock.calls[0]?.[0]).toMatchObject({
      executorId: "CEXECUTOR",
      targetId: "CREGISTRY",
      caller: "GCALLER",
      loanId: 7,
      reason: "EarlyRepayment",
      signTransaction: signTransactionMock,
    });
    expect(closeEvmLoanMock).not.toHaveBeenCalled();
  });

  it("stays on the Stellar arm for a legacy row without a chain id", async () => {
    closeLoanMock.mockResolvedValue({ hash: "abc" });
    const { result } = renderHook(() => useCloseLoan(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...INPUT, chainId: undefined });
    });
    expect(closeLoanMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unset ids and a disconnected wallet before any call", async () => {
    hoisted.env = { ...ENV_CONFIGURED, STELLAR_LOAN_REGISTRY_ID: "" };
    const first = renderHook(() => useCloseLoan(), { wrapper });
    await expect(first.result.current.mutateAsync(INPUT)).rejects.toThrow(
      "On-chain loan closing is not configured for this environment.",
    );
    hoisted.env = { ...ENV_CONFIGURED };
    stellarWalletState = {
      address: "",
      isConnected: false,
      signTransaction: signTransactionMock,
    };
    const second = renderHook(() => useCloseLoan(), { wrapper });
    await expect(second.result.current.mutateAsync(INPUT)).rejects.toThrow(
      "Stellar wallet not connected.",
    );
    expect(closeLoanMock).not.toHaveBeenCalled();
  });
});

describe("useCloseLoan (EVM arm)", () => {
  it("threads accessManager, registry, caller, the signing chain and reason", async () => {
    closeEvmLoanMock.mockResolvedValue({ hash: "0xevm" });
    const { result } = renderHook(() => useCloseLoan(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(EVM_INPUT)).resolves.toEqual({
        hash: "0xevm",
      });
    });
    expect(closeEvmLoanMock.mock.calls[0]?.[0]).toMatchObject({
      accessManager: ENV_CONFIGURED.EVM_ACCESS_MANAGER_ADDRESS,
      registry: ENV_CONFIGURED.EVM_LOAN_REGISTRY_ADDRESS,
      caller: EVM_ADDRESS,
      chainId: EVM_CHAIN,
      loanId: 7,
      reason: "EarlyRepayment",
    });
    expect(closeLoanMock).not.toHaveBeenCalled();
  });

  it.each([
    ["registry", { EVM_LOAN_REGISTRY_ADDRESS: "" }],
    ["access manager", { EVM_ACCESS_MANAGER_ADDRESS: "" }],
  ])("rejects an unset %s before any call", async (_n, patch) => {
    hoisted.env = { ...ENV_CONFIGURED, ...patch };
    const { result } = renderHook(() => useCloseLoan(), { wrapper });
    await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
      "On-chain loan closing is not configured for this environment.",
    );
    expect(closeEvmLoanMock).not.toHaveBeenCalled();
  });

  it("rejects a disconnected EVM wallet before any call", async () => {
    evmWalletState = { address: "", isConnected: false };
    const { result } = renderHook(() => useCloseLoan(), { wrapper });
    await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
      "EVM wallet not connected.",
    );
    expect(closeEvmLoanMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown chain with the Stellar-only copy", async () => {
    const { result } = renderHook(() => useCloseLoan(), { wrapper });
    await expect(
      result.current.mutateAsync({ ...INPUT, chainId: 1234 }),
    ).rejects.toThrow(/Stellar only/);
    expect(closeEvmLoanMock).not.toHaveBeenCalled();
    expect(closeLoanMock).not.toHaveBeenCalled();
  });

  it("surfaces the stage", async () => {
    closeEvmLoanMock.mockImplementationOnce(
      async (params: { onStageChange?: (s: string) => void }) => {
        params.onStageChange?.("confirming");
        return { hash: "0xdef" };
      },
    );
    const { result } = renderHook(() => useCloseLoan(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(EVM_INPUT);
    });
    await waitFor(() => expect(result.current.stage).toBe("confirming"));
  });

  it("invalidates the loan book and financials, again at 5 s and 15 s", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    closeEvmLoanMock.mockResolvedValue({ hash: "0xevm" });
    const { result } = renderHook(() => useCloseLoan(), { wrapper });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(EVM_INPUT);
    });
    expect(spy).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(spy).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(spy).toHaveBeenCalledTimes(6);
  });
});

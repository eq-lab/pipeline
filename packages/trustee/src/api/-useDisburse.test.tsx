// spec: docs/frontend/trustee-flows.md#disburse-1898
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDisburse } from "./useDisburse";

const disburseMock = vi.fn();
const readRefHashSeenMock = vi.fn();
const fetchMinterPausedMock = vi.fn();
const signTransactionMock = vi.fn();
let walletState = {
  address: "GCALLER",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  disburse: (...args: unknown[]) => disburseMock(...args),
  readRefHashSeen: (...args: unknown[]) => readRefHashSeenMock(...args),
  bankReferenceRefHash: async (reference: string) => `hash:${reference.trim()}`,
  readCanCall: vi.fn(),
  readDebtTrustline: vi.fn(),
  readLoanDisbursementState: vi.fn(),
  readLoanOwner: vi.fn(),
  useStellarWallet: () => walletState,
}));
vi.mock("./useConversions", () => ({
  fetchMinterPaused: () => fetchMinterPausedMock(),
  minterPoolStateKey: (id: string) => ["minter-pool-state", id],
}));

const { ENV_CONFIGURED, envMock } = vi.hoisted(() => {
  const configured = {
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_CHAIN_ID: 560_048,
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_YIELD_MINTER_ID: "CMINTER",
    STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CEXEC",
    STELLAR_LOAN_REGISTRY_ID: "CREGISTRY",
    STELLAR_DEAL_TOKEN_FACTORY_ID: "CFACTORY",
  };
  return { ENV_CONFIGURED: configured, envMock: { ...configured } };
});
vi.mock("@/lib/env", () => ({ ENV: envMock }));

let queryClient: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const INPUT = {
  chainId: 99_000_001,
  loanId: 0,
  amountRaw: "500000000000",
  valueDate: 1_770_000_000,
  reference: " WIRE-1 ",
};

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  disburseMock.mockReset();
  readRefHashSeenMock.mockReset();
  readRefHashSeenMock.mockResolvedValue(false);
  fetchMinterPausedMock.mockReset();
  fetchMinterPausedMock.mockResolvedValue(false);
  signTransactionMock.mockReset();
  Object.assign(envMock, ENV_CONFIGURED);
  walletState = {
    address: "GCALLER",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useDisburse", () => {
  it("refuses an EVM loan before any chain call", async () => {
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...INPUT, chainId: 560_048 }),
      ).rejects.toThrow(/Stellar only/);
    });
    expect(disburseMock).not.toHaveBeenCalled();
  });

  it("short-circuits when not configured", async () => {
    envMock.STELLAR_DEAL_TOKEN_FACTORY_ID = "";
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        "Disbursement isn't configured for this environment.",
      );
    });
    expect(disburseMock).not.toHaveBeenCalled();
  });

  it("requires a connected wallet", async () => {
    walletState = {
      address: "",
      isConnected: false,
      signTransaction: signTransactionMock,
    };
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        "Stellar wallet not connected.",
      );
    });
    expect(disburseMock).not.toHaveBeenCalled();
  });

  it("refuses a consumed reference without requesting a signature", async () => {
    readRefHashSeenMock.mockResolvedValue(true);
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        /already recorded on-chain/,
      );
    });
    expect(readRefHashSeenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        refHash: "hash:WIRE-1",
      }),
    );
    expect(disburseMock).not.toHaveBeenCalled();
    expect(signTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses when the minter is paused", async () => {
    fetchMinterPausedMock.mockResolvedValue(true);
    const { result } = renderHook(() => useDisburse(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        /minter is paused/,
      );
    });
    expect(disburseMock).not.toHaveBeenCalled();
  });

  it("disburses with the trimmed-reference hash and env ids, then invalidates", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    disburseMock.mockResolvedValue({ hash: "tx-hash" });
    const { result } = renderHook(() => useDisburse(), { wrapper });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).resolves.toEqual({
        hash: "tx-hash",
      });
    });
    expect(disburseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CEXEC",
        minterId: "CMINTER",
        caller: "GCALLER",
        loanId: 0,
        amountRaw: "500000000000",
        valueDate: 1_770_000_000,
        refHash: "hash:WIRE-1",
        signTransaction: signTransactionMock,
      }),
    );
    for (const key of [
      "loan-disbursement",
      "loan-book",
      "cash-book",
      "audit-log",
      "debt-trustline",
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["minter-pool-state", "CMINTER"],
    });
    const immediate = invalidate.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(invalidate.mock.calls.length).toBe(immediate * 2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(invalidate.mock.calls.length).toBe(immediate * 3);
  });
});

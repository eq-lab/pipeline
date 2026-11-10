// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRecordIncome } from "./useRecordIncome";

const recordIncomeMock = vi.fn();
const readRefHashSeenMock = vi.fn();
const signTransactionMock = vi.fn();
let walletState = {
  address: "GCALLER",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  recordIncome: (...args: unknown[]) => recordIncomeMock(...args),
  readRefHashSeen: (...args: unknown[]) => readRefHashSeenMock(...args),
  bankReferenceRefHash: async (reference: string) => `hash:${reference.trim()}`,
  useStellarWallet: () => walletState,
}));

const ENV_CONFIGURED = {
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_YIELD_MINTER_ID: "CMINTER",
};
let envMock = { ...ENV_CONFIGURED };
vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

let queryClient: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const INPUT = {
  amount: "1250.50",
  valueDate: 1_770_000_000,
  reference: " BANK-REF-1 ",
};

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  recordIncomeMock.mockReset();
  readRefHashSeenMock.mockReset();
  readRefHashSeenMock.mockResolvedValue(false);
  envMock = { ...ENV_CONFIGURED };
  walletState = {
    address: "GCALLER",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
});

describe("useRecordIncome", () => {
  it("short-circuits when the minter id is unset", async () => {
    envMock = { ...ENV_CONFIGURED, STELLAR_YIELD_MINTER_ID: "" };
    const { result } = renderHook(() => useRecordIncome(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        "On-chain bank income booking is not configured for this environment.",
      );
    });
    expect(recordIncomeMock).not.toHaveBeenCalled();
  });

  it("short-circuits when no wallet is connected", async () => {
    walletState = {
      address: "",
      isConnected: false,
      signTransaction: signTransactionMock,
    };
    const { result } = renderHook(() => useRecordIncome(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        "Stellar wallet not connected.",
      );
    });
    expect(recordIncomeMock).not.toHaveBeenCalled();
  });

  it("throws RefHashSeen and never books when the reference is consumed", async () => {
    readRefHashSeenMock.mockResolvedValue(true);
    const { result } = renderHook(() => useRecordIncome(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        /^RefHashSeen/,
      );
    });
    expect(readRefHashSeenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        refHash: "hash:BANK-REF-1",
      }),
    );
    expect(recordIncomeMock).not.toHaveBeenCalled();
  });

  it("passes amount, value date and hash through and invalidates the caches", async () => {
    recordIncomeMock.mockResolvedValue({ hash: "tx-hash" });
    const { result } = renderHook(() => useRecordIncome(), { wrapper });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });
    expect(recordIncomeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        caller: "GCALLER",
        amount: "1250.50",
        valueDate: 1_770_000_000,
        refHash: "hash:BANK-REF-1",
        signTransaction: signTransactionMock,
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["capital-allocation"],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["audit-log"] });
  });
});

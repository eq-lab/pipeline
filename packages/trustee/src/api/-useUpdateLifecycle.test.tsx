/**
 * Tests for `useUpdateLifecycle.ts` (issue #872). Mirrors `-useRollover.test.tsx`:
 * `updateMutable` and `useStellarWallet` (from `@pipeline/wallet-connect`) are
 * mocked so the hook is exercised without a real wallet / Soroban RPC.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUpdateLifecycle } from "./useUpdateLifecycle";

const updateMutableMock = vi.fn();
const signTransactionMock = vi.fn();
let stellarWalletState = {
  address: "GCALLER0000000000000000000000000000000000000000000000000",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  updateMutable: (...args: unknown[]) => updateMutableMock(...args),
  useStellarWallet: () => stellarWalletState,
}));

const ENV_CONFIGURED = {
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_LOAN_REGISTRY_ID:
    "CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID:
    "CAGCWDZYWDN6USS3YY7BA2FGRCLOPGHBTSPJ6VRSPAJSMGFPONFIAREF",
};

let envMock = { ...ENV_CONFIGURED };

vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return wrapper;
}

const INPUT = {
  loanId: 4488,
  status: "WatchList",
  ccrPercent: 135,
  location: "Vessel MV Andes",
  metadataUri: "",
};

beforeEach(() => {
  envMock = { ...ENV_CONFIGURED };
  stellarWalletState = {
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
  updateMutableMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useUpdateLifecycle", () => {
  it("threads env + wallet + fields through to updateMutable", async () => {
    updateMutableMock.mockResolvedValueOnce({ hash: "0xabc" });

    const { result } = renderHook(() => useUpdateLifecycle(), {
      wrapper: makeWrapper(),
    });

    let hash: string | undefined;
    await act(async () => {
      hash = (await result.current.mutateAsync(INPUT)).hash;
    });

    expect(hash).toBe("0xabc");
    expect(updateMutableMock.mock.calls[0]?.[0]).toMatchObject({
      executorId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
      targetId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_ID,
      caller: stellarWalletState.address,
      loanId: 4488,
      status: "WatchList",
      ccrPercent: 135,
      location: "Vessel MV Andes",
      metadataUri: "",
    });
  });

  it("rejects before calling updateMutable when the registry ids are unset", async () => {
    envMock = {
      ...ENV_CONFIGURED,
      STELLAR_LOAN_REGISTRY_ID: "",
      STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "",
    };
    const { result } = renderHook(() => useUpdateLifecycle(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
      /not configured/,
    );
    expect(updateMutableMock).not.toHaveBeenCalled();
  });

  it("rejects before calling updateMutable when the wallet is disconnected", async () => {
    stellarWalletState = {
      address: "",
      isConnected: false,
      signTransaction: signTransactionMock,
    };
    const { result } = renderHook(() => useUpdateLifecycle(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
      /wallet not connected/,
    );
    expect(updateMutableMock).not.toHaveBeenCalled();
  });
});

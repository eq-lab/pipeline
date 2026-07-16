/**
 * Tests for `useRollover.ts` (issue #870). Mirrors `-useDrawLoan.test.tsx`:
 * `rollover` and `useStellarWallet` (from `@pipeline/wallet-connect`) are mocked
 * so the hook is exercised without a real wallet / Soroban RPC.
 *
 * Covers:
 *   - Unconfigured registry/executor ids → rejects before calling `rollover`.
 *   - Disconnected wallet → rejects before calling `rollover`.
 *   - Happy path threads executor/target/caller + loanId/newRateBps/newMaturity
 *     + injected `signTransaction` through to `rollover`.
 *   - `stage` reflects `rollover`'s `onStageChange` callback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRollover } from "./useRollover";

const rolloverMock = vi.fn();
const signTransactionMock = vi.fn();
let stellarWalletState = {
  address: "GCALLER0000000000000000000000000000000000000000000000000",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  rollover: (...args: unknown[]) => rolloverMock(...args),
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

const INPUT = { loanId: 4488, newRateBps: 1450, newMaturity: 1_790_000_000 };

beforeEach(() => {
  envMock = { ...ENV_CONFIGURED };
  stellarWalletState = {
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
  rolloverMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRollover", () => {
  it("threads env + wallet through to rollover on the happy path", async () => {
    rolloverMock.mockResolvedValueOnce({ hash: "0xabc" });

    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });

    let hash: string | undefined;
    await act(async () => {
      hash = (await result.current.mutateAsync(INPUT)).hash;
    });

    expect(hash).toBe("0xabc");
    expect(rolloverMock).toHaveBeenCalledTimes(1);
    expect(rolloverMock.mock.calls[0]?.[0]).toMatchObject({
      executorId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
      targetId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_ID,
      caller: stellarWalletState.address,
      loanId: 4488,
      newRateBps: 1450,
      newMaturity: 1_790_000_000,
    });
  });

  it("rejects before calling rollover when the registry ids are unset", async () => {
    envMock = {
      ...ENV_CONFIGURED,
      STELLAR_LOAN_REGISTRY_ID: "",
      STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "",
    };

    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
      /not configured/,
    );
    expect(rolloverMock).not.toHaveBeenCalled();
  });

  it("rejects before calling rollover when the wallet is disconnected", async () => {
    stellarWalletState = {
      address: "",
      isConnected: false,
      signTransaction: signTransactionMock,
    };

    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
      /wallet not connected/,
    );
    expect(rolloverMock).not.toHaveBeenCalled();
  });

  it("surfaces the rollover progress stage", async () => {
    rolloverMock.mockImplementationOnce(
      async (params: { onStageChange?: (s: string) => void }) => {
        params.onStageChange?.("confirming");
        return { hash: "0xdef" };
      },
    );

    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });

    await waitFor(() => expect(result.current.stage).toBe("confirming"));
  });
});

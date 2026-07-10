/**
 * Tests for `src/api/useDrawLoan.ts` (issue #831).
 *
 * `drawLoan` and `useStellarWallet` (from `@pipeline/wallet-connect`) are
 * mocked — no real Soroban RPC / wallet access. Mirrors
 * `-useCapitalWalletBalance.test.tsx`'s structure.
 *
 * Covers:
 *   - Unconfigured registry/executor ids → rejects before calling `drawLoan`.
 *   - Disconnected wallet → rejects before calling `drawLoan`.
 *   - Success → resolves `{ hash }`, passes the configured ids + connected
 *     address + injected `signTransaction` through to `drawLoan`.
 *   - `stage` reflects `drawLoan`'s `onStageChange` callback.
 *   - A `drawLoan` rejection propagates as the mutation's `error`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDrawLoan } from "./useDrawLoan";
import type { SubmitLoanRequest } from "@pipeline/wallet-connect";

// ── Mock @pipeline/wallet-connect ─────────────────────────────────────────────

const drawLoanMock = vi.fn();
const signTransactionMock = vi.fn();
let stellarWalletState = {
  address: "GCALLER0000000000000000000000000000000000000000000000000",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  drawLoan: (...args: unknown[]) => drawLoanMock(...args),
  useStellarWallet: () => stellarWalletState,
}));

// ── Mock @/lib/env ────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const LOAN_DATA = {
  to: "GHOLDER00000000000000000000000000000000000000000000000000",
  metadata_uri: "ipfs://loan-metadata",
  economics: {
    original_facility_size: "1200000.000000",
    original_senior_tranche: "1000000.000000",
    original_equity_tranche: "200000.000000",
    original_offtaker_price: "1250000.000000",
    senior_interest_rate_bps: 1000,
    origination_date: 1_750_000_000,
    original_maturity_date: 1_780_000_000,
  },
  initial_ccr: 1_500_000,
  initial_location: {
    location_type: "Vessel",
    location_identifier: "IMO-1234567",
    tracking_url: "https://track.example/1234567",
    updated_at: 1_750_000_100,
  },
} as unknown as SubmitLoanRequest;

beforeEach(() => {
  envMock = { ...ENV_CONFIGURED };
  stellarWalletState = {
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
  drawLoanMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useDrawLoan", () => {
  it("rejects with a 'not configured' error and does not call drawLoan when the registry id is unset", async () => {
    envMock = { ...ENV_CONFIGURED, STELLAR_LOAN_REGISTRY_ID: "" };
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ loanData: LOAN_DATA })),
    ).rejects.toThrow("not configured");
    expect(drawLoanMock).not.toHaveBeenCalled();
  });

  it("rejects with a 'not configured' error and does not call drawLoan when the executor id is unset", async () => {
    envMock = { ...ENV_CONFIGURED, STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "" };
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ loanData: LOAN_DATA })),
    ).rejects.toThrow("not configured");
    expect(drawLoanMock).not.toHaveBeenCalled();
  });

  it("rejects with a 'not connected' error and does not call drawLoan when the wallet is disconnected", async () => {
    stellarWalletState = {
      ...stellarWalletState,
      address: undefined as unknown as string,
      isConnected: false,
    };
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ loanData: LOAN_DATA })),
    ).rejects.toThrow("not connected");
    expect(drawLoanMock).not.toHaveBeenCalled();
  });

  it("resolves { hash } and passes ids/caller/signTransaction to drawLoan", async () => {
    drawLoanMock.mockResolvedValueOnce({ hash: "tx-hash" });
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    let resolved: { hash: string } | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync({ loanData: LOAN_DATA });
    });

    expect(resolved).toEqual({ hash: "tx-hash" });
    expect(drawLoanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executorId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_ID,
        caller: stellarWalletState.address,
        loanData: LOAN_DATA,
        rpcUrl: ENV_CONFIGURED.STELLAR_RPC_URL,
        networkPassphrase: ENV_CONFIGURED.STELLAR_NETWORK_PASSPHRASE,
        signTransaction: signTransactionMock,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("reflects drawLoan's onStageChange callback in `stage`", async () => {
    drawLoanMock.mockImplementation(
      async (params: { onStageChange?: (s: string) => void }) => {
        params.onStageChange?.("awaiting-signature");
        params.onStageChange?.("submitting");
        params.onStageChange?.("confirming");
        return { hash: "tx-hash" };
      },
    );
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ loanData: LOAN_DATA });
    });

    expect(result.current.stage).toBe("confirming");
  });

  it("propagates a drawLoan rejection as the mutation error", async () => {
    drawLoanMock.mockRejectedValueOnce(new Error("Signature cancelled"));
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ loanData: LOAN_DATA })),
    ).rejects.toThrow("Signature cancelled");

    await waitFor(() => {
      expect(result.current.error?.message).toBe("Signature cancelled");
    });
  });
});

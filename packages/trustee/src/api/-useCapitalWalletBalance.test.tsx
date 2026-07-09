/**
 * Tests for `src/api/useCapitalWalletBalance.ts` (issue #805).
 *
 * `getSacBalance` (from `@pipeline/wallet-connect`) is mocked — no real
 * Soroban RPC access. Mirrors `-useCapitalAllocation.test.tsx`'s structure.
 *
 * Covers:
 *   - Unset custody id / USDC id → no RPC call, `data === undefined`.
 *   - Successful read → scaled human-decimal string.
 *   - Sentinel / read error → `error` set, `data === undefined`.
 *   - Query key includes the RPC url + USDC id + custody id.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCapitalWalletBalance } from "./useCapitalWalletBalance";

// ── Mock @pipeline/wallet-connect ─────────────────────────────────────────────

const getSacBalanceMock = vi.fn();

vi.mock("@pipeline/wallet-connect", () => ({
  getSacBalance: (...args: unknown[]) => getSacBalanceMock(...args),
}));

// ── Mock @/lib/env ────────────────────────────────────────────────────────────

const ENV_CONFIGURED = {
  API_BASE_URL: "http://localhost:8080",
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  WALLETCONNECT_PROJECT_ID: "replace-me",
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_CHAIN_ID: 99_000_001,
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_USDC_ID: "CB3SHE2S5QMO4GLM65B6DADFRL7K5JPUSKNVJIXJG37ZRABZJRN5DEE6",
  STELLAR_USDC_CUSTODY_ID:
    "GCUSTODY0000000000000000000000000000000000000000000000000",
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
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return wrapper;
}

beforeEach(() => {
  envMock = { ...ENV_CONFIGURED };
  getSacBalanceMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── useCapitalWalletBalance ───────────────────────────────────────────────────

describe("useCapitalWalletBalance", () => {
  it("does not call getSacBalance and returns undefined when USDC id is unset", () => {
    envMock = { ...ENV_CONFIGURED, STELLAR_USDC_ID: "" };

    const { result } = renderHook(() => useCapitalWalletBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getSacBalanceMock).not.toHaveBeenCalled();
  });

  it("does not call getSacBalance and returns undefined when custody id is unset", () => {
    envMock = { ...ENV_CONFIGURED, STELLAR_USDC_CUSTODY_ID: "" };

    const { result } = renderHook(() => useCapitalWalletBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(getSacBalanceMock).not.toHaveBeenCalled();
  });

  it("returns the scaled human-decimal string on a successful read", async () => {
    // 8,400,000 USDC at 7-decimal SAC scale.
    getSacBalanceMock.mockResolvedValueOnce(84_000_000_000_000n);

    const { result } = renderHook(() => useCapitalWalletBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe("8400000.0000000");
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("passes RPC url, passphrase, USDC id, and custody id to getSacBalance", async () => {
    getSacBalanceMock.mockResolvedValueOnce(10_000_000n);

    const { result } = renderHook(() => useCapitalWalletBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe("1.0000000");
    });

    expect(getSacBalanceMock).toHaveBeenCalledWith({
      sorobanRpcUrl: ENV_CONFIGURED.STELLAR_RPC_URL,
      networkPassphrase: ENV_CONFIGURED.STELLAR_NETWORK_PASSPHRASE,
      sacContractId: ENV_CONFIGURED.STELLAR_USDC_ID,
      account: ENV_CONFIGURED.STELLAR_USDC_CUSTODY_ID,
    });
  });

  it("sets error and leaves data undefined when the read fails (e.g. sentinel)", async () => {
    getSacBalanceMock.mockRejectedValueOnce(
      new Error("getSacBalance: balance returned i64 max sentinel"),
    );

    const { result } = renderHook(() => useCapitalWalletBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeUndefined();
  });
});

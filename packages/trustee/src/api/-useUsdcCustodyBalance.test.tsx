import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUsdcCustodyBalance } from "./useUsdcCustodyBalance";

// ── Mock @pipeline/wallet-connect ─────────────────────────────────────────────

const getSacBalanceMock = vi.fn();
const getErc20BalanceMock = vi.fn();

vi.mock("@pipeline/wallet-connect", () => ({
  getSacBalance: (...args: unknown[]) => getSacBalanceMock(...args),
  getErc20Balance: (...args: unknown[]) => getErc20BalanceMock(...args),
}));

// ── Mock @/lib/env ────────────────────────────────────────────────────────────

const ENV_CONFIGURED = {
  API_BASE_URL: "http://localhost:8080",
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  EVM_USDC_ADDRESS: "0xe198F1EEF83Dd613B874FC3c2D5BAf6C8a4A4597",
  EVM_USDC_CUSTODY_ADDRESS: "0xE122330dBA9394BCAaAAcA580EFd21665b0FA8fA",
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
  getErc20BalanceMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── useUsdcCustodyBalance ───────────────────────────────────────────────────

describe("useUsdcCustodyBalance", () => {
  it("does not call getSacBalance and returns undefined when USDC id is unset", () => {
    envMock = { ...ENV_CONFIGURED, STELLAR_USDC_ID: "" };

    const { result } = renderHook(() => useUsdcCustodyBalance(99_000_001), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getSacBalanceMock).not.toHaveBeenCalled();
  });

  it("does not call getSacBalance and returns undefined when custody id is unset", () => {
    envMock = { ...ENV_CONFIGURED, STELLAR_USDC_CUSTODY_ID: "" };

    const { result } = renderHook(() => useUsdcCustodyBalance(99_000_001), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(getSacBalanceMock).not.toHaveBeenCalled();
  });

  it("returns the scaled human-decimal string on a successful read", async () => {
    getSacBalanceMock.mockResolvedValueOnce(84_000_000_000_000n);

    const { result } = renderHook(() => useUsdcCustodyBalance(99_000_001), {
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

    const { result } = renderHook(() => useUsdcCustodyBalance(99_000_001), {
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

    const { result } = renderHook(() => useUsdcCustodyBalance(99_000_001), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeUndefined();
  });

  it("reads the EVM custody through getErc20Balance scaled by the token decimals", async () => {
    getErc20BalanceMock.mockResolvedValueOnce({
      raw: 10_000_000_000n,
      decimals: 6,
    });

    const { result } = renderHook(() => useUsdcCustodyBalance(560048), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe("10000.000000");
    });
    expect(getErc20BalanceMock).toHaveBeenCalledWith({
      rpcUrl: ENV_CONFIGURED.EVM_RPC_URL,
      tokenAddress: ENV_CONFIGURED.EVM_USDC_ADDRESS,
      account: ENV_CONFIGURED.EVM_USDC_CUSTODY_ADDRESS,
    });
    expect(getSacBalanceMock).not.toHaveBeenCalled();
  });

  it("never calls getErc20Balance on the Stellar arm", async () => {
    getSacBalanceMock.mockResolvedValueOnce(10_000_000n);

    const { result } = renderHook(() => useUsdcCustodyBalance(99_000_001), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe("1.0000000");
    });
    expect(getErc20BalanceMock).not.toHaveBeenCalled();
  });

  it.each([["EVM_USDC_ADDRESS"], ["EVM_USDC_CUSTODY_ADDRESS"]])(
    "makes no call and returns the unconfigured result when %s is empty",
    (key) => {
      envMock = { ...ENV_CONFIGURED, [key]: "" };

      const { result } = renderHook(() => useUsdcCustodyBalance(560048), {
        wrapper: makeWrapper(),
      });

      expect(result.current).toEqual({
        data: undefined,
        isLoading: false,
        error: null,
      });
      expect(getErc20BalanceMock).not.toHaveBeenCalled();
      expect(getSacBalanceMock).not.toHaveBeenCalled();
    },
  );

  it("makes no call for a chain id that is neither configured chain", () => {
    const { result } = renderHook(() => useUsdcCustodyBalance(1), {
      wrapper: makeWrapper(),
    });

    expect(result.current).toEqual({
      data: undefined,
      isLoading: false,
      error: null,
    });
    expect(getErc20BalanceMock).not.toHaveBeenCalled();
    expect(getSacBalanceMock).not.toHaveBeenCalled();
  });

  it("surfaces an EVM read error and leaves data undefined", async () => {
    getErc20BalanceMock.mockRejectedValueOnce(new Error("rate limited"));

    const { result } = renderHook(() => useUsdcCustodyBalance(560048), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeUndefined();
  });

  it("does not serve the previous chain's data after a chain switch", async () => {
    getSacBalanceMock.mockResolvedValue(10_000_000n);
    getErc20BalanceMock.mockResolvedValue({ raw: 5_000_000n, decimals: 6 });

    const { result, rerender } = renderHook(
      ({ chainId }) => useUsdcCustodyBalance(chainId),
      { wrapper: makeWrapper(), initialProps: { chainId: 99_000_001 } },
    );
    await waitFor(() => {
      expect(result.current.data).toBe("1.0000000");
    });

    rerender({ chainId: 560048 });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => {
      expect(result.current.data).toBe("5.000000");
    });
  });
});

// spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDrawLoan } from "./useDrawLoan";
import type { DrawLoanArgs } from "@pipeline/wallet-connect";

// ── Mock @pipeline/wallet-connect ─────────────────────────────────────────────

const drawLoanMock = vi.fn();
const drawEvmLoanMock = vi.fn();
const signTransactionMock = vi.fn();
let stellarWalletState = {
  address: "GCALLER0000000000000000000000000000000000000000000000000",
  isConnected: true,
  signTransaction: signTransactionMock,
};

let evmWalletState: { address: string | undefined; isConnected: boolean } = {
  address: "0x00000000000000000000000000000000000000c1",
  isConnected: true,
};

vi.mock("@pipeline/wallet-connect", () => ({
  drawLoan: (...args: unknown[]) => drawLoanMock(...args),
  drawEvmLoan: (...args: unknown[]) => drawEvmLoanMock(...args),
  useStellarWallet: () => stellarWalletState,
  useEvmWallet: () => evmWalletState,
}));

// ── Mock @/lib/env ────────────────────────────────────────────────────────────

const STELLAR = 99_000_001;
const EVM = 560048;

const ENV_CONFIGURED = {
  STELLAR_CHAIN_ID: STELLAR,
  EVM_CHAIN_ID: EVM,
  EVM_LOAN_REGISTRY_ADDRESS: "0x00000000000000000000000000000000000000b1",
  EVM_ACCESS_MANAGER_ADDRESS: "0x00000000000000000000000000000000000000a1",
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_LOAN_REGISTRY_ID:
    "CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID:
    "CAGCWDZYWDN6USS3YY7BA2FGRCLOPGHBTSPJ6VRSPAJSMGFPONFIAREF",
};

const envHolder = vi.hoisted(() => ({
  value: {} as Record<string, string | number>,
}));
envHolder.value = { ...ENV_CONFIGURED };

vi.mock("@/lib/env", () => ({
  get ENV() {
    return envHolder.value;
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

const DRAW_ARGS: DrawLoanArgs = {
  metadata_uri: "ipfs://loan-metadata",
  economics: {
    borrower_ref:
      "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12",
    original_facility_size: "12000000000000",
    original_senior_tranche: "10000000000000",
    original_equity_tranche: "2000000000000",
    original_offtaker_price: "12500000000000",
    senior_interest_rate: 100000,
    origination_date: 1_750_000_000,
    original_maturity_date: 1_780_000_000,
  },
};

beforeEach(() => {
  envHolder.value = { ...ENV_CONFIGURED };
  stellarWalletState = {
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
  evmWalletState = {
    address: "0x00000000000000000000000000000000000000c1",
    isConnected: true,
  };
  drawLoanMock.mockReset();
  drawEvmLoanMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useDrawLoan", () => {
  it("rejects with a 'not configured' error and does not call drawLoan when the registry id is unset", async () => {
    envHolder.value = { ...ENV_CONFIGURED, STELLAR_LOAN_REGISTRY_ID: "" };
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({ args: DRAW_ARGS, chainId: STELLAR }),
      ),
    ).rejects.toThrow("not configured");
    expect(drawLoanMock).not.toHaveBeenCalled();
  });

  it("rejects with a 'not configured' error and does not call drawLoan when the executor id is unset", async () => {
    envHolder.value = {
      ...ENV_CONFIGURED,
      STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "",
    };
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({ args: DRAW_ARGS, chainId: STELLAR }),
      ),
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
      act(() =>
        result.current.mutateAsync({ args: DRAW_ARGS, chainId: STELLAR }),
      ),
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
      resolved = await result.current.mutateAsync({
        args: DRAW_ARGS,
        chainId: STELLAR,
      });
    });

    expect(resolved).toEqual({ hash: "tx-hash" });
    expect(drawLoanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executorId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_ID,
        caller: stellarWalletState.address,
        args: DRAW_ARGS,
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
      await result.current.mutateAsync({ args: DRAW_ARGS, chainId: STELLAR });
    });

    expect(result.current.stage).toBe("confirming");
  });

  it("propagates a drawLoan rejection as the mutation error", async () => {
    drawLoanMock.mockRejectedValueOnce(new Error("Signature cancelled"));
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({ args: DRAW_ARGS, chainId: STELLAR }),
      ),
    ).rejects.toThrow("Signature cancelled");

    await waitFor(() => {
      expect(result.current.error?.message).toBe("Signature cancelled");
    });
  });

  it("takes the Stellar arm for a legacy row without a target chain", async () => {
    drawLoanMock.mockResolvedValueOnce({ hash: "tx-hash", loanId: 3 });
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ args: DRAW_ARGS, chainId: undefined });
    });

    expect(drawLoanMock).toHaveBeenCalledTimes(1);
    expect(drawEvmLoanMock).not.toHaveBeenCalled();
  });
});

describe("useDrawLoan on the EVM chain", () => {
  it.each([
    ["registry", { EVM_LOAN_REGISTRY_ADDRESS: "" }],
    ["access manager", { EVM_ACCESS_MANAGER_ADDRESS: "" }],
  ])("rejects as not configured when the %s is unset", async (_n, patch) => {
    envHolder.value = { ...ENV_CONFIGURED, ...patch };
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ args: DRAW_ARGS, chainId: EVM })),
    ).rejects.toThrow("not configured");
    expect(drawEvmLoanMock).not.toHaveBeenCalled();
    expect(drawLoanMock).not.toHaveBeenCalled();
  });

  it("rejects when the EVM wallet is disconnected", async () => {
    evmWalletState = { address: undefined, isConnected: false };
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ args: DRAW_ARGS, chainId: EVM })),
    ).rejects.toThrow("EVM wallet not connected.");
    expect(drawEvmLoanMock).not.toHaveBeenCalled();
  });

  it("resolves { hash, loanId } and passes the EVM config to drawEvmLoan", async () => {
    drawEvmLoanMock.mockResolvedValueOnce({ hash: "0xabc", loanId: 7 });
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    let resolved: unknown;
    await act(async () => {
      resolved = await result.current.mutateAsync({
        args: DRAW_ARGS,
        chainId: EVM,
      });
    });

    expect(resolved).toEqual({ hash: "0xabc", loanId: 7 });
    expect(drawEvmLoanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManager: ENV_CONFIGURED.EVM_ACCESS_MANAGER_ADDRESS,
        registry: ENV_CONFIGURED.EVM_LOAN_REGISTRY_ADDRESS,
        caller: evmWalletState.address,
        chainId: EVM,
        args: DRAW_ARGS,
      }),
    );
    expect(drawLoanMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.mintedLoanId).toBe(7));
  });

  it("reflects drawEvmLoan's onStageChange callback in `stage`", async () => {
    drawEvmLoanMock.mockImplementation(
      async (params: { onStageChange?: (s: string) => void }) => {
        params.onStageChange?.("awaiting-signature");
        params.onStageChange?.("confirming");
        return { hash: "0xabc", loanId: null };
      },
    );
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ args: DRAW_ARGS, chainId: EVM });
    });

    expect(result.current.stage).toBe("confirming");
  });

  it("propagates a drawEvmLoan rejection", async () => {
    drawEvmLoanMock.mockRejectedValueOnce(new Error("User rejected."));
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ args: DRAW_ARGS, chainId: EVM })),
    ).rejects.toThrow("User rejected.");
    await waitFor(() => {
      expect(result.current.error?.message).toBe("User rejected.");
    });
  });

  it("throws the draw chain reason for an unknown chain without calling a draw", async () => {
    const { result } = renderHook(() => useDrawLoan(), {
      wrapper: makeWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ args: DRAW_ARGS, chainId: 1234 })),
    ).rejects.toThrow("drawing on Chain 1234");
    expect(drawEvmLoanMock).not.toHaveBeenCalled();
    expect(drawLoanMock).not.toHaveBeenCalled();
  });
});

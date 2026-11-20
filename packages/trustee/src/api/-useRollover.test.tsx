// spec: docs/frontend/trustee-flows.md#wired-actions
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRollover } from "./useRollover";

const hoisted = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const rolloverMock = vi.fn();
const rolloverEvmMock = vi.fn();
const signTransactionMock = vi.fn();
const EVM_CHAIN = 560048;
const STELLAR_CHAIN = 1000;
const EVM_ADDRESS = "0x00000000000000000000000000000000000000c1";
let evmWalletState = { address: EVM_ADDRESS, isConnected: true };
let stellarWalletState = {
  address: "GCALLER0000000000000000000000000000000000000000000000000",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  rollover: (...args: unknown[]) => rolloverMock(...args),
  rolloverEvmLoan: (...args: unknown[]) => rolloverEvmMock(...args),
  useStellarWallet: () => stellarWalletState,
  useEvmWallet: () => evmWalletState,
}));

const ENV_CONFIGURED = {
  STELLAR_CHAIN_ID: STELLAR_CHAIN,
  EVM_CHAIN_ID: EVM_CHAIN,
  EVM_LOAN_REGISTRY_ADDRESS: "0x00000000000000000000000000000000000000b1",
  EVM_ACCESS_MANAGER_ADDRESS: "0x00000000000000000000000000000000000000a1",
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_LOAN_REGISTRY_ID:
    "CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID:
    "CAGCWDZYWDN6USS3YY7BA2FGRCLOPGHBTSPJ6VRSPAJSMGFPONFIAREF",
};

hoisted.env = { ...ENV_CONFIGURED };

vi.mock("@/lib/env", () => ({
  get ENV() {
    return hoisted.env;
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
  newRateBps: 1450,
  newMaturity: 1_790_000_000,
  chainId: STELLAR_CHAIN,
};
const EVM_INPUT = { ...INPUT, chainId: EVM_CHAIN };

beforeEach(() => {
  hoisted.env = { ...ENV_CONFIGURED };
  stellarWalletState = {
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
  evmWalletState = { address: EVM_ADDRESS, isConnected: true };
  rolloverMock.mockReset();
  rolloverEvmMock.mockReset();
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
    hoisted.env = {
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

describe("useRollover (Stellar arm unchanged)", () => {
  it("stays on the Stellar arm for a legacy row without a chain id", async () => {
    rolloverMock.mockResolvedValueOnce({ hash: "0xabc" });
    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({ ...INPUT, chainId: undefined });
    });
    expect(rolloverMock).toHaveBeenCalledTimes(1);
    expect(rolloverEvmMock).not.toHaveBeenCalled();
  });
});

describe("useRollover (EVM arm)", () => {
  it("threads accessManager, registry, caller and the signing chain", async () => {
    rolloverEvmMock.mockResolvedValueOnce({ hash: "0xevm" });
    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });
    let hash: string | undefined;
    await act(async () => {
      hash = (await result.current.mutateAsync(EVM_INPUT)).hash;
    });
    expect(hash).toBe("0xevm");
    expect(rolloverMock).not.toHaveBeenCalled();
    expect(rolloverEvmMock.mock.calls[0]?.[0]).toMatchObject({
      accessManager: ENV_CONFIGURED.EVM_ACCESS_MANAGER_ADDRESS,
      registry: ENV_CONFIGURED.EVM_LOAN_REGISTRY_ADDRESS,
      caller: EVM_ADDRESS,
      chainId: EVM_CHAIN,
      loanId: 4488,
      newRateBps: 1450,
      newMaturity: 1_790_000_000,
    });
  });

  it.each([
    ["registry", { EVM_LOAN_REGISTRY_ADDRESS: "" }],
    ["access manager", { EVM_ACCESS_MANAGER_ADDRESS: "" }],
  ])("rejects an unset %s before any call", async (_n, patch) => {
    hoisted.env = { ...ENV_CONFIGURED, ...patch };
    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
      "On-chain rollover is not configured for this environment.",
    );
    expect(rolloverEvmMock).not.toHaveBeenCalled();
  });

  it("rejects a disconnected EVM wallet before any call", async () => {
    evmWalletState = { address: "", isConnected: false };
    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
      "EVM wallet not connected.",
    );
    expect(rolloverEvmMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown chain with the Stellar-only copy", async () => {
    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });
    await expect(
      result.current.mutateAsync({ ...INPUT, chainId: 1234 }),
    ).rejects.toThrow(/Stellar only/);
    expect(rolloverEvmMock).not.toHaveBeenCalled();
    expect(rolloverMock).not.toHaveBeenCalled();
  });

  it("surfaces the stage", async () => {
    rolloverEvmMock.mockImplementationOnce(
      async (params: { onStageChange?: (s: string) => void }) => {
        params.onStageChange?.("awaiting-signature");
        return { hash: "0xdef" };
      },
    );
    const { result } = renderHook(() => useRollover(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(EVM_INPUT);
    });
    await waitFor(() =>
      expect(result.current.stage).toBe("awaiting-signature"),
    );
  });
});

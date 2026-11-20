// spec: docs/frontend/trustee-flows.md#wired-actions
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanMutableState, useUpdateLifecycle } from "./useUpdateLifecycle";

const hoisted = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const updateMutableMock = vi.fn();
const updateEvmMutableMock = vi.fn();
const readLoanChainStateMock = vi.fn();
const readEvmLoanChainStateMock = vi.fn();
const signTransactionMock = vi.fn();
const STELLAR_CHAIN = 99_000_001;
const EVM_CHAIN = 560048;
const EVM_ADDRESS = "0x00000000000000000000000000000000000000c1";
let evmWalletState = { address: EVM_ADDRESS, isConnected: true };
let stellarWalletState = {
  address: "GCALLER0000000000000000000000000000000000000000000000000",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  updateMutable: (...args: unknown[]) => updateMutableMock(...args),
  updateEvmMutable: (...args: unknown[]) => updateEvmMutableMock(...args),
  readLoanChainState: (...args: unknown[]) => readLoanChainStateMock(...args),
  readEvmLoanChainState: (...args: unknown[]) =>
    readEvmLoanChainStateMock(...args),
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
  status: "WatchList",
  metadataUri: "ipfs://cur",
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
  updateMutableMock.mockReset();
  updateEvmMutableMock.mockReset();
  readLoanChainStateMock.mockReset();
  readEvmLoanChainStateMock.mockReset();
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
    const call = updateMutableMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      executorId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
      targetId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_ID,
      caller: stellarWalletState.address,
      loanId: 4488,
      status: "WatchList",
      metadataUri: "ipfs://cur",
    });
    expect(call).not.toHaveProperty("ccrPercent");
    expect(call).not.toHaveProperty("location");
  });

  it("rejects before calling updateMutable when the registry ids are unset", async () => {
    hoisted.env = {
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

describe("useLoanMutableState", () => {
  it("maps readLoanChainState to { status, metadataUri } verbatim", async () => {
    readLoanChainStateMock.mockResolvedValueOnce({
      status: "Performing",
      metadataUri: " ipfs://cur ",
      currentRate: 1,
    });
    const { result } = renderHook(
      () => useLoanMutableState(STELLAR_CHAIN, 4488, true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      status: "Performing",
      metadataUri: " ipfs://cur ",
    });
    expect(readLoanChainStateMock.mock.calls[0]?.[0]).toMatchObject({
      registryId: ENV_CONFIGURED.STELLAR_LOAN_REGISTRY_ID,
      loanId: 4488,
    });
  });

  it("is disabled for an unknown chain", () => {
    const { result } = renderHook(() => useLoanMutableState(1, 4488, true), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(readLoanChainStateMock).not.toHaveBeenCalled();
  });

  it("is disabled when enabled is false", () => {
    const { result } = renderHook(
      () => useLoanMutableState(STELLAR_CHAIN, 4488, false),
      { wrapper: makeWrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(readLoanChainStateMock).not.toHaveBeenCalled();
  });
});

describe("useUpdateLifecycle (EVM arm)", () => {
  it("threads accessManager, registry, caller, the signing chain and fields", async () => {
    updateEvmMutableMock.mockResolvedValueOnce({ hash: "0xevm" });
    const { result } = renderHook(() => useUpdateLifecycle(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(EVM_INPUT);
    });
    expect(updateMutableMock).not.toHaveBeenCalled();
    expect(updateEvmMutableMock.mock.calls[0]?.[0]).toMatchObject({
      accessManager: ENV_CONFIGURED.EVM_ACCESS_MANAGER_ADDRESS,
      registry: ENV_CONFIGURED.EVM_LOAN_REGISTRY_ADDRESS,
      caller: EVM_ADDRESS,
      chainId: EVM_CHAIN,
      loanId: 4488,
      status: "WatchList",
      metadataUri: "ipfs://cur",
    });
  });

  it("stays on the Stellar arm for a legacy row without a chain id", async () => {
    updateMutableMock.mockResolvedValueOnce({ hash: "0xabc" });
    const { result } = renderHook(() => useUpdateLifecycle(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({ ...INPUT, chainId: undefined });
    });
    expect(updateMutableMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unset registry or access manager before any call", async () => {
    hoisted.env = { ...ENV_CONFIGURED, EVM_ACCESS_MANAGER_ADDRESS: "" };
    const { result } = renderHook(() => useUpdateLifecycle(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
      "On-chain lifecycle updates are not configured for this environment.",
    );
    expect(updateEvmMutableMock).not.toHaveBeenCalled();
  });

  it("rejects a disconnected EVM wallet before any call", async () => {
    evmWalletState = { address: "", isConnected: false };
    const { result } = renderHook(() => useUpdateLifecycle(), {
      wrapper: makeWrapper(),
    });
    await expect(result.current.mutateAsync(EVM_INPUT)).rejects.toThrow(
      "EVM wallet not connected.",
    );
    expect(updateEvmMutableMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown chain with the Stellar-only copy", async () => {
    const { result } = renderHook(() => useUpdateLifecycle(), {
      wrapper: makeWrapper(),
    });
    await expect(
      result.current.mutateAsync({ ...INPUT, chainId: 1234 }),
    ).rejects.toThrow(/Stellar only/);
    expect(updateEvmMutableMock).not.toHaveBeenCalled();
    expect(updateMutableMock).not.toHaveBeenCalled();
  });
});

describe("useLoanMutableState (EVM)", () => {
  it("reads readEvmLoanChainState and maps it to { status, metadataUri }", async () => {
    readEvmLoanChainStateMock.mockResolvedValueOnce({
      status: "Approved",
      metadataUri: " ipfs://x ",
      currentRate: 1,
    });
    const { result } = renderHook(
      () => useLoanMutableState(EVM_CHAIN, 4488, true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      status: "Approved",
      metadataUri: " ipfs://x ",
    });
    expect(readEvmLoanChainStateMock.mock.calls[0]?.[0]).toEqual({
      registry: ENV_CONFIGURED.EVM_LOAN_REGISTRY_ADDRESS,
      loanId: 4488,
    });
    expect(readLoanChainStateMock).not.toHaveBeenCalled();
  });

  it("is disabled when the EVM registry is unset", () => {
    hoisted.env = { ...ENV_CONFIGURED, EVM_LOAN_REGISTRY_ADDRESS: "" };
    const { result } = renderHook(
      () => useLoanMutableState(EVM_CHAIN, 4488, true),
      { wrapper: makeWrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(readEvmLoanChainStateMock).not.toHaveBeenCalled();
  });
});

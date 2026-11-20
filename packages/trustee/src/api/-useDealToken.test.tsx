// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useDeal,
  useEvmDeal,
  useLoanDeal,
  useRegisterDeal,
  useRegisterDealAccess,
} from "./useDealToken";

const mocks = vi.hoisted(() => ({
  readDeal: vi.fn(),
  readEvmDeal: vi.fn(),
  registerDeal: vi.fn(),
  readCanCall: vi.fn(),
  readOperationSchedule: vi.fn(),
  readEvmCanCall: vi.fn(),
  readEvmOperationSchedule: vi.fn(),
  relayEvmRegisterDeal: vi.fn(),
  sign: vi.fn(),
  wallet: { address: "GTRUSTEE" as string | null, isConnected: true },
  evmWallet: { address: "0xTRUSTEE" as string | null, isConnected: true },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  readDeal: mocks.readDeal,
  readEvmDeal: mocks.readEvmDeal,
  registerDeal: mocks.registerDeal,
  registerDealArgs: (loanId: number) => [`u32:${loanId}`],
  readCanCall: mocks.readCanCall,
  readOperationSchedule: mocks.readOperationSchedule,
  readEvmCanCall: mocks.readEvmCanCall,
  readEvmOperationSchedule: mocks.readEvmOperationSchedule,
  relayEvmRegisterDeal: mocks.relayEvmRegisterDeal,
  evmRegisterDealSelector: () => "0x19da0d36",
  encodeEvmRegisterDealCalldata: (loanId: number) => `0xdata${loanId}`,
  useEvmWallet: () => ({
    address: mocks.evmWallet.address,
    isConnected: mocks.evmWallet.isConnected,
  }),
  useStellarWallet: () => ({
    address: mocks.wallet.address,
    isConnected: mocks.wallet.isConnected,
    signTransaction: mocks.sign,
  }),
}));

const ENV_CONFIGURED = {
  STELLAR_CHAIN_ID: 99_000_001,
  EVM_CHAIN_ID: 560_048,
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_DEAL_TOKEN_FACTORY_ID: "CFACTORY",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CAM",
  EVM_DEAL_TOKEN_FACTORY_ADDRESS: "0xFACTORY",
  EVM_ACCESS_MANAGER_ADDRESS: "0xAM",
};
const envMock = vi.hoisted(() => ({}) as Record<string, string | number>);
vi.mock("@/lib/env", () => ({ ENV: envMock }));

const STELLAR = 99_000_001;
const EVM = 560_048;
let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  Object.assign(envMock, ENV_CONFIGURED);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.wallet.address = "GTRUSTEE";
  mocks.wallet.isConnected = true;
  mocks.evmWallet.address = "0xTRUSTEE";
  mocks.evmWallet.isConnected = true;
  for (const key of [
    "readDeal",
    "readEvmDeal",
    "registerDeal",
    "readCanCall",
    "readOperationSchedule",
    "readEvmCanCall",
    "readEvmOperationSchedule",
    "relayEvmRegisterDeal",
  ] as const) {
    mocks[key].mockReset();
  }
});

describe("useDeal", () => {
  it("reads deal() on the configured factory for a Stellar loan", async () => {
    mocks.readDeal.mockResolvedValue({ debt: "CDEBT" });
    const { result } = renderHook(() => useDeal(STELLAR, 7), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ debt: "CDEBT" }));
    expect(mocks.readDeal).toHaveBeenCalledWith({
      factoryId: "CFACTORY",
      loanId: 7,
      rpcUrl: ENV_CONFIGURED.STELLAR_RPC_URL,
      networkPassphrase: ENV_CONFIGURED.STELLAR_NETWORK_PASSPHRASE,
    });
  });

  it("is disabled when unconfigured, non-Stellar or without a loan id", () => {
    envMock.STELLAR_DEAL_TOKEN_FACTORY_ID = "";
    renderHook(() => useDeal(STELLAR, 7), { wrapper });
    envMock.STELLAR_DEAL_TOKEN_FACTORY_ID = "CFACTORY";
    renderHook(() => useDeal(EVM, 7), { wrapper });
    renderHook(() => useDeal(STELLAR, null), { wrapper });
    renderHook(() => useDeal(STELLAR, 1.5), { wrapper });
    expect(mocks.readDeal).not.toHaveBeenCalled();
  });
});

describe("useEvmDeal", () => {
  it("keeps its cache apart from useDeal, so invalidation runs only its own reader", async () => {
    mocks.readEvmDeal.mockResolvedValue({ debt: "0xDEBT" });
    const evm = renderHook(
      () => ({ stellar: useDeal(EVM, 7), evm: useEvmDeal(EVM, 7) }),
      { wrapper },
    );
    await waitFor(() =>
      expect(evm.result.current.evm.data).toEqual({ debt: "0xDEBT" }),
    );
    expect(evm.result.current.stellar.data).toBeUndefined();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["deal-token"] });
      await queryClient.invalidateQueries({ queryKey: ["evm-deal-token"] });
    });
    expect(mocks.readDeal).not.toHaveBeenCalled();
    expect(mocks.readEvmDeal).toHaveBeenCalledTimes(2);
    expect(evm.result.current.stellar.data).toBeUndefined();
  });
});

describe("useLoanDeal", () => {
  it("returns the Stellar query for Stellar and the EVM query for EVM", async () => {
    mocks.readDeal.mockResolvedValue({ debt: "CDEBT" });
    mocks.readEvmDeal.mockResolvedValue({ debt: "0xDEBT" });
    const stellar = renderHook(() => useLoanDeal(STELLAR, 7), { wrapper });
    await waitFor(() =>
      expect(stellar.result.current.data).toEqual({ debt: "CDEBT" }),
    );
    const evm = renderHook(() => useLoanDeal(EVM, 7), { wrapper });
    await waitFor(() =>
      expect(evm.result.current.data).toEqual({ debt: "0xDEBT" }),
    );
    expect(mocks.readDeal).toHaveBeenCalledTimes(1);
    expect(mocks.readEvmDeal).toHaveBeenCalledTimes(1);
  });
});

describe("useRegisterDealAccess", () => {
  it("reads can_call on the factory without a schedule for an immediate role", async () => {
    mocks.readCanCall.mockResolvedValue({ immediate: true, delay: 0 });
    const { result } = renderHook(
      () => useRegisterDealAccess(STELLAR, 7, true),
      {
        wrapper,
      },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mocks.readCanCall).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CAM",
        caller: "GTRUSTEE",
        target: "CFACTORY",
        fn: "register_deal",
      }),
    );
    expect(mocks.readOperationSchedule).not.toHaveBeenCalled();
    expect(result.current.data?.schedule).toBeNull();
  });

  it("reads the operation schedule for a delayed role", async () => {
    mocks.readCanCall.mockResolvedValue({ immediate: false, delay: 3600 });
    mocks.readOperationSchedule.mockResolvedValue({
      operationId: "ab",
      readyAt: 0,
    });
    const { result } = renderHook(
      () => useRegisterDealAccess(STELLAR, 7, true),
      {
        wrapper,
      },
    );
    await waitFor(() => expect(result.current.data?.schedule).not.toBeNull());
    expect(mocks.readOperationSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["u32:7"], fn: "register_deal" }),
    );
  });

  it("is disabled without a wallet, when not enabled, or unconfigured", () => {
    mocks.wallet.address = null;
    renderHook(() => useRegisterDealAccess(STELLAR, 7, true), { wrapper });
    mocks.wallet.address = "GTRUSTEE";
    renderHook(() => useRegisterDealAccess(STELLAR, 7, false), { wrapper });
    envMock.STELLAR_DEAL_TOKEN_FACTORY_ID = "";
    renderHook(() => useRegisterDealAccess(STELLAR, 7, true), { wrapper });
    expect(mocks.readCanCall).not.toHaveBeenCalled();
  });
});

describe("useRegisterDealAccess on EVM", () => {
  it("reads canCall on the factory selector without a schedule for an immediate role", async () => {
    mocks.readEvmCanCall.mockResolvedValue({ immediate: true, delay: 0 });
    const { result } = renderHook(() => useRegisterDealAccess(EVM, 7, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mocks.readEvmCanCall).toHaveBeenCalledWith({
      accessManager: "0xAM",
      caller: "0xTRUSTEE",
      target: "0xFACTORY",
      selector: "0x19da0d36",
    });
    expect(mocks.readEvmOperationSchedule).not.toHaveBeenCalled();
    expect(mocks.readCanCall).not.toHaveBeenCalled();
    expect(result.current.data?.schedule).toBeNull();
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ).toContainEqual(["register-deal-access", EVM, "0xTRUSTEE", 7]);
  });

  it("reads the operation schedule with the calldata for a delayed role", async () => {
    mocks.readEvmCanCall.mockResolvedValue({ immediate: false, delay: 3600 });
    mocks.readEvmOperationSchedule.mockResolvedValue({
      operationId: "ab",
      readyAt: 0,
    });
    const { result } = renderHook(() => useRegisterDealAccess(EVM, 7, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.schedule).not.toBeNull());
    expect(mocks.readEvmOperationSchedule).toHaveBeenCalledWith({
      accessManager: "0xAM",
      caller: "0xTRUSTEE",
      target: "0xFACTORY",
      data: "0xdata7",
    });
  });

  it("is disabled on another chain, without a wallet, unconfigured, or when not enabled", () => {
    renderHook(() => useRegisterDealAccess(1, 7, true), { wrapper });
    mocks.evmWallet.address = null;
    renderHook(() => useRegisterDealAccess(EVM, 7, true), { wrapper });
    mocks.evmWallet.address = "0xTRUSTEE";
    renderHook(() => useRegisterDealAccess(EVM, 7, false), { wrapper });
    envMock.EVM_DEAL_TOKEN_FACTORY_ADDRESS = "";
    renderHook(() => useRegisterDealAccess(EVM, 7, true), { wrapper });
    envMock.EVM_DEAL_TOKEN_FACTORY_ADDRESS = "0xFACTORY";
    envMock.EVM_ACCESS_MANAGER_ADDRESS = "";
    renderHook(() => useRegisterDealAccess(EVM, 7, true), { wrapper });
    expect(mocks.readEvmCanCall).not.toHaveBeenCalled();
  });
});

describe("useRegisterDeal", () => {
  it("relays register_deal and invalidates the deal and access queries", async () => {
    mocks.registerDeal.mockResolvedValue({ hash: "h" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRegisterDeal(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        mode: "execute",
        loanId: 7,
        chainId: STELLAR,
      });
    });
    expect(mocks.registerDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "execute",
        accessManagerId: "CAM",
        factoryId: "CFACTORY",
        loanId: 7,
        caller: "GTRUSTEE",
        signTransaction: mocks.sign,
      }),
    );
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey?.[0]);
    expect(keys).toEqual(
      expect.arrayContaining(["deal-token", "register-deal-access"]),
    );
    expect(mocks.relayEvmRegisterDeal).not.toHaveBeenCalled();
  });

  it("rejects before relaying for another chain, unconfigured or disconnected", async () => {
    const { result } = renderHook(() => useRegisterDeal(), { wrapper });
    await expect(
      act(() =>
        result.current.mutateAsync({
          mode: "execute",
          loanId: 7,
          chainId: 1,
        }),
      ),
    ).rejects.toThrow(/Stellar only/);

    envMock.STELLAR_DEAL_TOKEN_FACTORY_ID = "";
    await expect(
      act(() =>
        result.current.mutateAsync({
          mode: "execute",
          loanId: 7,
          chainId: STELLAR,
        }),
      ),
    ).rejects.toThrow(/isn't configured/);

    envMock.STELLAR_DEAL_TOKEN_FACTORY_ID = "CFACTORY";
    mocks.wallet.isConnected = false;
    const disconnected = renderHook(() => useRegisterDeal(), { wrapper });
    await expect(
      act(() =>
        disconnected.result.current.mutateAsync({
          mode: "execute",
          loanId: 7,
          chainId: STELLAR,
        }),
      ),
    ).rejects.toThrow(/not connected/);
    expect(mocks.registerDeal).not.toHaveBeenCalled();
  });
});

describe("useRegisterDeal on EVM", () => {
  it("relays registerDeal through the EVM arm and invalidates both deal caches, now and at 5 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      mocks.relayEvmRegisterDeal.mockResolvedValue({ hash: "0xh" });
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useRegisterDeal(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({
          mode: "execute",
          loanId: 7,
          chainId: EVM,
        });
      });
      expect(mocks.relayEvmRegisterDeal).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "execute",
          accessManager: "0xAM",
          factory: "0xFACTORY",
          caller: "0xTRUSTEE",
          loanId: 7,
          chainId: EVM,
        }),
      );
      expect(mocks.registerDeal).not.toHaveBeenCalled();
      const names = () => invalidate.mock.calls.map((c) => c[0]?.queryKey?.[0]);
      expect(names()).toEqual(
        expect.arrayContaining([
          "deal-token",
          "evm-deal-token",
          "register-deal-access",
          "audit-log",
        ]),
      );
      const before = invalidate.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      expect(invalidate.mock.calls.length).toBe(before + 4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("guards in order: chain, config, wallet", async () => {
    const { result } = renderHook(() => useRegisterDeal(), { wrapper });
    const run = (chainId: number) =>
      act(() =>
        result.current.mutateAsync({ mode: "execute", loanId: 7, chainId }),
      );
    await expect(run(1)).rejects.toThrow(/Stellar only/);
    envMock.EVM_ACCESS_MANAGER_ADDRESS = "";
    await expect(run(EVM)).rejects.toThrow(/isn't configured/);
    envMock.EVM_ACCESS_MANAGER_ADDRESS = "0xAM";
    mocks.evmWallet.isConnected = false;
    const disconnected = renderHook(() => useRegisterDeal(), { wrapper });
    await expect(
      act(() =>
        disconnected.result.current.mutateAsync({
          mode: "execute",
          loanId: 7,
          chainId: EVM,
        }),
      ),
    ).rejects.toThrow("EVM wallet not connected.");
    expect(mocks.relayEvmRegisterDeal).not.toHaveBeenCalled();
  });

  it("refetches readEvmDeal and never readDeal after an EVM registration", async () => {
    mocks.readEvmDeal.mockResolvedValue(null);
    mocks.relayEvmRegisterDeal.mockResolvedValue({ hash: "0xh" });
    const { result } = renderHook(
      () => ({
        deal: useEvmDeal(EVM, 7),
        stellarDeal: useDeal(EVM, 7),
        register: useRegisterDeal(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(mocks.readEvmDeal).toHaveBeenCalledTimes(1));
    mocks.readEvmDeal.mockResolvedValue({ debt: "0xDEBT" });
    await act(async () => {
      await result.current.register.mutateAsync({
        mode: "execute",
        loanId: 7,
        chainId: EVM,
      });
    });
    await waitFor(() =>
      expect(result.current.deal.data).toEqual({ debt: "0xDEBT" }),
    );
    expect(mocks.readDeal).not.toHaveBeenCalled();
  });
});

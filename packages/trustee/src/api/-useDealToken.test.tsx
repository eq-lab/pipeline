// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useDeal,
  useRegisterDeal,
  useRegisterDealAccess,
} from "./useDealToken";

const mocks = vi.hoisted(() => ({
  readDeal: vi.fn(),
  registerDeal: vi.fn(),
  readCanCall: vi.fn(),
  readOperationSchedule: vi.fn(),
  sign: vi.fn(),
  wallet: { address: "GTRUSTEE" as string | null, isConnected: true },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  readDeal: mocks.readDeal,
  registerDeal: mocks.registerDeal,
  registerDealArgs: (loanId: number) => [`u32:${loanId}`],
  readCanCall: mocks.readCanCall,
  readOperationSchedule: mocks.readOperationSchedule,
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
  for (const key of [
    "readDeal",
    "registerDeal",
    "readCanCall",
    "readOperationSchedule",
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

describe("useRegisterDealAccess", () => {
  it("reads can_call on the factory without a schedule for an immediate role", async () => {
    mocks.readCanCall.mockResolvedValue({ immediate: true, delay: 0 });
    const { result } = renderHook(() => useRegisterDealAccess(7, true), {
      wrapper,
    });
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
    const { result } = renderHook(() => useRegisterDealAccess(7, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.schedule).not.toBeNull());
    expect(mocks.readOperationSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["u32:7"], fn: "register_deal" }),
    );
  });

  it("is disabled without a wallet, when not enabled, or unconfigured", () => {
    mocks.wallet.address = null;
    renderHook(() => useRegisterDealAccess(7, true), { wrapper });
    mocks.wallet.address = "GTRUSTEE";
    renderHook(() => useRegisterDealAccess(7, false), { wrapper });
    envMock.STELLAR_DEAL_TOKEN_FACTORY_ID = "";
    renderHook(() => useRegisterDealAccess(7, true), { wrapper });
    expect(mocks.readCanCall).not.toHaveBeenCalled();
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
  });

  it("rejects before relaying for EVM, unconfigured or disconnected", async () => {
    const { result } = renderHook(() => useRegisterDeal(), { wrapper });
    await expect(
      act(() =>
        result.current.mutateAsync({
          mode: "execute",
          loanId: 7,
          chainId: EVM,
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

// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const walletMock = vi.hoisted(() => ({
  state: {
    address: "GCALLER" as string | undefined,
    isConnected: true,
    signTransaction: vi.fn(),
  },
  openRamp: vi.fn(),
  closeRamp: vi.fn(),
  recordExpense: vi.fn(),
  readCanCall: vi.fn(),
  readMinterRamp: vi.fn(),
  readMinterPoolState: vi.fn(),
  readMinterPaused: vi.fn(),
}));

vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => walletMock.state,
  openRamp: (...a: unknown[]) => walletMock.openRamp(...a),
  closeRamp: (...a: unknown[]) => walletMock.closeRamp(...a),
  recordExpense: (...a: unknown[]) => walletMock.recordExpense(...a),
  readCanCall: (...a: unknown[]) => walletMock.readCanCall(...a),
  readMinterRamp: (...a: unknown[]) => walletMock.readMinterRamp(...a),
  readMinterPoolState: (...a: unknown[]) =>
    walletMock.readMinterPoolState(...a),
  readMinterPaused: (...a: unknown[]) => walletMock.readMinterPaused(...a),
}));

const envMock = vi.hoisted(() => ({
  STELLAR_RPC_URL: "https://rpc.test",
  STELLAR_NETWORK_PASSPHRASE: "Test",
  STELLAR_YIELD_MINTER_ID: "CMINTER",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CAM",
}));
vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

import {
  useCloseRamp,
  useConversionAccess,
  useMinterPaused,
  useMinterPoolState,
  useMinterRamps,
  useOpenRamp,
  useRecordExpense,
} from "./useConversions";

const HASH = "ab".repeat(32);

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  walletMock.state.address = "GCALLER";
  walletMock.state.isConnected = true;
  envMock.STELLAR_YIELD_MINTER_ID = "CMINTER";
  envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
  for (const fn of [
    walletMock.openRamp,
    walletMock.closeRamp,
    walletMock.recordExpense,
    walletMock.readCanCall,
    walletMock.readMinterRamp,
    walletMock.readMinterPoolState,
    walletMock.readMinterPaused,
  ]) {
    fn.mockReset();
  }
});

describe("useConversionAccess", () => {
  it.each(["open_ramp", "close_ramp", "record_expense"] as const)(
    "reads can_call for %s on the minter under a per-wallet key",
    async (fn) => {
      walletMock.readCanCall.mockResolvedValue({ immediate: true, delay: 0 });
      const { result } = renderHook(() => useConversionAccess(fn, true), {
        wrapper,
      });
      await waitFor(() => expect(result.current.data?.immediate).toBe(true));
      expect(walletMock.readCanCall).toHaveBeenCalledWith(
        expect.objectContaining({
          accessManagerId: "CAM",
          caller: "GCALLER",
          target: "CMINTER",
          fn,
        }),
      );
      expect(client.getQueryData(["conversion-access", "GCALLER", fn])).toEqual(
        { immediate: true, delay: 0 },
      );
    },
  );

  it("stays disabled when unconfigured or disabled", () => {
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    renderHook(() => useConversionAccess("open_ramp", true), { wrapper });
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
    renderHook(() => useConversionAccess("open_ramp", false), { wrapper });
    expect(walletMock.readCanCall).not.toHaveBeenCalled();
  });
});

describe("chain reads", () => {
  it("reads each ramp id under the minter-ramp key, including id 0", async () => {
    walletMock.readMinterRamp.mockImplementation(
      async ({ id }: { id: number }) => ({ id, closed: false }),
    );
    const { result } = renderHook(() => useMinterRamps([0, 4], true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.every((q) => q.isSuccess)).toBe(true),
    );
    expect(walletMock.readMinterRamp).toHaveBeenCalledWith(
      expect.objectContaining({ minterId: "CMINTER", id: 0 }),
    );
    expect(client.getQueryData(["minter-ramp", "CMINTER", 4])).toEqual({
      id: 4,
      closed: false,
    });
  });

  it("does not read ramps when disabled", () => {
    renderHook(() => useMinterRamps([1], false), { wrapper });
    expect(walletMock.readMinterRamp).not.toHaveBeenCalled();
  });

  it("reads pool_state under the minter-pool-state key", async () => {
    const pool = {
      bankCash: "7341220000000",
      inFlight: "0",
      totalAssets: "7341220000000",
      readFailed: false,
    };
    walletMock.readMinterPoolState.mockResolvedValue(pool);
    const { result } = renderHook(() => useMinterPoolState(true), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(pool));
    expect(walletMock.readMinterPoolState).toHaveBeenCalledWith(
      expect.objectContaining({ minterId: "CMINTER" }),
    );
    expect(client.getQueryData(["minter-pool-state", "CMINTER"])).toEqual(pool);
  });

  it("reads paused under the minter-paused key and respects enabled", async () => {
    walletMock.readMinterPaused.mockResolvedValue(false);
    renderHook(() => useMinterPaused(false), { wrapper });
    expect(walletMock.readMinterPaused).not.toHaveBeenCalled();
    const { result } = renderHook(() => useMinterPaused(true), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(false));
    expect(client.getQueryData(["minter-paused", "CMINTER"])).toBe(false);
  });
});

describe("mutations", () => {
  it("preflight guards run before any call", async () => {
    envMock.STELLAR_YIELD_MINTER_ID = "";
    const { result } = renderHook(() => useOpenRamp(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          direction: "UsdcToBank",
          amountRaw: "10",
          refHash: HASH,
        }),
      ).rejects.toThrow(/not configured for this environment/);
    });
    envMock.STELLAR_YIELD_MINTER_ID = "CMINTER";
    walletMock.state.isConnected = false;
    const second = renderHook(() => useRecordExpense(), { wrapper });
    await act(async () => {
      await expect(
        second.result.current.mutateAsync({
          deltaRaw: "10",
          valueDate: 1,
          refHash: HASH,
        }),
      ).rejects.toThrow(/Stellar wallet not connected/);
    });
    expect(walletMock.openRamp).not.toHaveBeenCalled();
    expect(walletMock.recordExpense).not.toHaveBeenCalled();
  });

  it("open: relays the direction and raw amount, then invalidates the book and pool", async () => {
    walletMock.openRamp.mockImplementation(
      async (p: { onStageChange: (s: string) => void }) => {
        p.onStageChange("submitting");
        return { hash: "H" };
      },
    );
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useOpenRamp(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        direction: "BankToUsdc",
        amountRaw: "12345670",
        refHash: HASH,
      });
    });
    expect(walletMock.openRamp).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        accessManagerId: "CAM",
        caller: "GCALLER",
        direction: "BankToUsdc",
        amountRaw: "12345670",
        refHash: HASH,
      }),
    );
    expect(result.current.stage).toBe("submitting");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["cash-book"] });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["minter-pool-state", "CMINTER"],
    });
    expect(spy).not.toHaveBeenCalledWith({
      queryKey: ["minter-ramp", "CMINTER", expect.anything()],
    });
  });

  it("close: relays id 0 with received 0 and invalidates that ramp", async () => {
    walletMock.closeRamp.mockResolvedValue({ hash: "C" });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCloseRamp(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: 0,
        receivedRaw: "0",
        refHash: HASH,
      });
    });
    expect(walletMock.closeRamp).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        id: 0,
        receivedRaw: "0",
        caller: "GCALLER",
      }),
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["minter-ramp", "CMINTER", 0],
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["minter-pool-state", "CMINTER"],
    });
  });

  it("expense: relays the raw delta and value date", async () => {
    walletMock.recordExpense.mockResolvedValue({ hash: "E" });
    const { result } = renderHook(() => useRecordExpense(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        deltaRaw: "52500000",
        valueDate: 1_700_000_000,
        refHash: HASH,
      });
    });
    expect(walletMock.recordExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        deltaRaw: "52500000",
        valueDate: 1_700_000_000,
        refHash: HASH,
      }),
    );
  });
});

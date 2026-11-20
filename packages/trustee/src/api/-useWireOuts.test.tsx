// spec: docs/frontend/trustee-flows.md#cash-management--bank-wire-outs
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
  settleWireOut: vi.fn(),
  cancelWireOut: vi.fn(),
  readCanCall: vi.fn(),
  readWireOutRecord: vi.fn(),
}));

vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => walletMock.state,
  settleWireOut: (...a: unknown[]) => walletMock.settleWireOut(...a),
  cancelWireOut: (...a: unknown[]) => walletMock.cancelWireOut(...a),
  readCanCall: (...a: unknown[]) => walletMock.readCanCall(...a),
  readWireOutRecord: (...a: unknown[]) => walletMock.readWireOutRecord(...a),
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
  useCancelWireOut,
  useSettleWireOut,
  useWireOutAccess,
  useWireOutRecords,
} from "./useWireOuts";

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
    walletMock.settleWireOut,
    walletMock.cancelWireOut,
    walletMock.readCanCall,
    walletMock.readWireOutRecord,
  ]) {
    fn.mockReset();
  }
});

describe("useWireOutAccess", () => {
  it("reads can_call on the minter under a per-wallet, per-fn key", async () => {
    walletMock.readCanCall.mockResolvedValue({ immediate: true, delay: 0 });
    const { result } = renderHook(
      () => useWireOutAccess("settle_wire_out", true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.immediate).toBe(true));
    expect(walletMock.readCanCall).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CAM",
        caller: "GCALLER",
        target: "CMINTER",
        fn: "settle_wire_out",
      }),
    );
    expect(
      client.getQueryData(["wire-out-access", "GCALLER", "settle_wire_out"]),
    ).toEqual({ immediate: true, delay: 0 });
  });

  it("stays disabled when unconfigured or disabled", () => {
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    renderHook(() => useWireOutAccess("cancel_wire_out", true), { wrapper });
    renderHook(() => useWireOutAccess("settle_wire_out", false), { wrapper });
    expect(walletMock.readCanCall).not.toHaveBeenCalled();
  });
});

describe("useWireOutRecords", () => {
  it("reads each id under the minter-wire-out key", async () => {
    walletMock.readWireOutRecord.mockImplementation(
      async ({ id }: { id: number }) => ({ id, status: "Pending" }),
    );
    const { result } = renderHook(() => useWireOutRecords([3, 4], true), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.every((q) => q.isSuccess)).toBe(true),
    );
    expect(walletMock.readWireOutRecord).toHaveBeenCalledWith(
      expect.objectContaining({ minterId: "CMINTER", id: 3 }),
    );
    expect(client.getQueryData(["minter-wire-out", "CMINTER", 4])).toEqual({
      id: 4,
      status: "Pending",
    });
  });

  it("does not read when disabled", () => {
    renderHook(() => useWireOutRecords([3], false), { wrapper });
    expect(walletMock.readWireOutRecord).not.toHaveBeenCalled();
  });
});

describe("mutations", () => {
  it("settle: preflight guards run before any call", async () => {
    envMock.STELLAR_YIELD_MINTER_ID = "";
    const input = {
      id: 1,
      amountRaw: "10",
      valueDate: 1,
      refHash: "ab".repeat(32),
    };
    const { result } = renderHook(() => useSettleWireOut(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow(
        /not configured for this environment/,
      );
    });
    envMock.STELLAR_YIELD_MINTER_ID = "CMINTER";
    walletMock.state.isConnected = false;
    const second = renderHook(() => useCancelWireOut(), { wrapper });
    await act(async () => {
      await expect(
        second.result.current.mutateAsync({ id: 1 }),
      ).rejects.toThrow(/Stellar wallet not connected/);
    });
    expect(walletMock.settleWireOut).not.toHaveBeenCalled();
    expect(walletMock.cancelWireOut).not.toHaveBeenCalled();
  });

  it("settle: relays with the raw amount, reports stages and invalidates", async () => {
    walletMock.settleWireOut.mockImplementation(
      async (p: { onStageChange: (s: string) => void }) => {
        p.onStageChange("submitting");
        return { hash: "H" };
      },
    );
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSettleWireOut(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        id: 3,
        amountRaw: "12345670",
        valueDate: 1_700_000_000,
        refHash: "ab".repeat(32),
      });
    });
    expect(walletMock.settleWireOut).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        accessManagerId: "CAM",
        caller: "GCALLER",
        id: 3,
        amountRaw: "12345670",
        valueDate: 1_700_000_000,
        refHash: "ab".repeat(32),
      }),
    );
    expect(result.current.stage).toBe("submitting");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["cash-book"] });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["minter-wire-out", "CMINTER", 3],
    });
  });

  it("cancel: relays the id", async () => {
    walletMock.cancelWireOut.mockResolvedValue({ hash: "C" });
    const { result } = renderHook(() => useCancelWireOut(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 5 });
    });
    expect(walletMock.cancelWireOut).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        id: 5,
        caller: "GCALLER",
      }),
    );
  });
});

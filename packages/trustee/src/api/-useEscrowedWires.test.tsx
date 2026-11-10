import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./client";

const walletMock = vi.hoisted(() => ({
  state: {
    address: "GCALLER" as string | undefined,
    isConnected: true,
    signTransaction: vi.fn(),
  },
  assignWireIn: vi.fn(),
  returnWireIn: vi.fn(),
  readCanCall: vi.fn(),
}));

vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => walletMock.state,
  assignWireIn: (...a: unknown[]) => walletMock.assignWireIn(...a),
  returnWireIn: (...a: unknown[]) => walletMock.returnWireIn(...a),
  readCanCall: (...a: unknown[]) => walletMock.readCanCall(...a),
  readMinterWireIn: vi.fn(),
  readMinterPlusdId: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
  STELLAR_RPC_URL: "https://rpc.test",
  STELLAR_NETWORK_PASSPHRASE: "Test",
  STELLAR_YIELD_MINTER_ID: "CMINTER",
  STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CAM",
  API_BASE_URL: "http://api.test",
}));
vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));
vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "tok",
}));

import {
  useAssignWireIn,
  useReturnWireIn,
  useWireEscrowAccess,
} from "./useEscrowedWires";
import { useCashBook } from "./useCashBook";

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  walletMock.state.address = "GCALLER";
  walletMock.state.isConnected = true;
  envMock.STELLAR_YIELD_MINTER_ID = "CMINTER";
  envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "CAM";
  walletMock.assignWireIn.mockReset();
  walletMock.returnWireIn.mockReset();
  walletMock.readCanCall.mockReset();
  fetchMock.mockReset();
});

describe("useWireEscrowAccess", () => {
  it("reads can_call on the minter under a per-wallet, per-fn key", async () => {
    walletMock.readCanCall.mockResolvedValue({ immediate: true, delay: 0 });
    const { result } = renderHook(
      () => useWireEscrowAccess("assign_wire_in", true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.immediate).toBe(true));
    expect(walletMock.readCanCall).toHaveBeenCalledWith(
      expect.objectContaining({
        accessManagerId: "CAM",
        caller: "GCALLER",
        target: "CMINTER",
        fn: "assign_wire_in",
      }),
    );
    expect(
      client.getQueryData(["wire-escrow-access", "GCALLER", "assign_wire_in"]),
    ).toEqual({ immediate: true, delay: 0 });
  });

  it("stays disabled when unconfigured or disabled", () => {
    envMock.STELLAR_LOAN_REGISTRY_EXECUTOR_ID = "";
    renderHook(() => useWireEscrowAccess("return_wire_in", true), { wrapper });
    renderHook(() => useWireEscrowAccess("assign_wire_in", false), { wrapper });
    expect(walletMock.readCanCall).not.toHaveBeenCalled();
  });
});

describe("mutations", () => {
  it("assign: preflight guards run before any call", async () => {
    envMock.STELLAR_YIELD_MINTER_ID = "";
    const { result } = renderHook(() => useAssignWireIn(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 1, receiver: "GLP" }),
      ).rejects.toThrow(/not configured for this environment/);
    });
    envMock.STELLAR_YIELD_MINTER_ID = "CMINTER";
    walletMock.state.isConnected = false;
    const second = renderHook(() => useAssignWireIn(), { wrapper });
    await act(async () => {
      await expect(
        second.result.current.mutateAsync({ id: 1, receiver: "GLP" }),
      ).rejects.toThrow(/Stellar wallet not connected/);
    });
    expect(walletMock.assignWireIn).not.toHaveBeenCalled();
  });

  it("assign: relays, reports stages and invalidates", async () => {
    walletMock.assignWireIn.mockImplementation(
      async (p: { onStageChange: (s: string) => void }) => {
        p.onStageChange("submitting");
        return { hash: "H" };
      },
    );
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAssignWireIn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 3, receiver: "GLP" });
    });
    expect(walletMock.assignWireIn).toHaveBeenCalledWith(
      expect.objectContaining({
        minterId: "CMINTER",
        accessManagerId: "CAM",
        caller: "GCALLER",
        id: 3,
        receiver: "GLP",
      }),
    );
    expect(result.current.stage).toBe("submitting");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["cash-book"] });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["minter-wire-in", "CMINTER", 3],
    });
  });

  it("return: relays with the ref hash", async () => {
    walletMock.returnWireIn.mockResolvedValue({ hash: "R" });
    const { result } = renderHook(() => useReturnWireIn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 3, refHash: "ab".repeat(32) });
    });
    expect(walletMock.returnWireIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, refHash: "ab".repeat(32) }),
    );
  });
});

describe("useCashBook", () => {
  it("requests the chain-scoped URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ wire_ins: [] }), { status: 200 }),
    );
    const { result } = renderHook(
      () => useCashBook(99_000_001, { enabled: true, refetchMs: 30_000 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/v1/cash-book?chain_id=99000001",
    );
  });

  it("does not fetch when disabled", () => {
    renderHook(
      () => useCashBook(560048, { enabled: false, refetchMs: 30_000 }),
      { wrapper },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry a 4xx", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "minter_not_configured" }), {
        status: 404,
      }),
    );
    const retryClient = new QueryClient();
    const { result } = renderHook(
      () => useCashBook(99_000_001, { enabled: true, refetchMs: 30_000 }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={retryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

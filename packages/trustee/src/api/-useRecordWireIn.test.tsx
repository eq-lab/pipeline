// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRecordWireIn, toValueDateSeconds } from "./useRecordWireIn";

const recordWireInMock = vi.fn();
const signTransactionMock = vi.fn();
let stellarWalletState = {
  address: "GCALLER0000000000000000000000000000000000000000000000000",
  isConnected: true,
  signTransaction: signTransactionMock,
};

vi.mock("@pipeline/wallet-connect", () => ({
  recordWireIn: (...args: unknown[]) => recordWireInMock(...args),
  useStellarWallet: () => stellarWalletState,
}));

const ENV_CONFIGURED = {
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_YIELD_MINTER_ID:
    "CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK",
};

let envMock = { ...ENV_CONFIGURED };

vi.mock("@/lib/env", () => ({
  get ENV() {
    return envMock;
  },
}));

let queryClient: QueryClient;

function makeWrapper() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const INPUT = {
  lpId: 12,
  depositId: 5,
  receiver: "GRECEIVER000000000000000000000000000000000000000000000000",
  amount: "50000.00",
  occurredAt: "2026-02-03T09:15:00Z",
  refHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
};

beforeEach(() => {
  envMock = { ...ENV_CONFIGURED };
  stellarWalletState = {
    address: "GCALLER0000000000000000000000000000000000000000000000000",
    isConnected: true,
    signTransaction: signTransactionMock,
  };
  recordWireInMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("toValueDateSeconds", () => {
  it("converts an ISO-8601 instant to Unix seconds", () => {
    expect(toValueDateSeconds("2026-02-03T09:15:00Z")).toBe(1_770_110_100);
  });

  it("throws on an unparseable timestamp", () => {
    expect(() => toValueDateSeconds("not-a-date")).toThrow(
      /Could not read the deposit's receipt time/,
    );
  });
});

describe("useRecordWireIn", () => {
  it("threads env, wallet, scaled args and value_date through to recordWireIn", async () => {
    recordWireInMock.mockResolvedValueOnce({ hash: "tx-hash", wireId: 9 });

    const { result } = renderHook(() => useRecordWireIn(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });

    expect(recordWireInMock).toHaveBeenCalledTimes(1);
    const call = recordWireInMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.minterId).toBe(ENV_CONFIGURED.STELLAR_YIELD_MINTER_ID);
    expect(call.caller).toBe(stellarWalletState.address);
    expect(call.receiver).toBe(INPUT.receiver);
    expect(call.amount).toBe("50000.00");
    expect(call.valueDate).toBe(1_770_110_100);
    expect(call.refHash).toBe(INPUT.refHash);
    expect(call.rpcUrl).toBe(ENV_CONFIGURED.STELLAR_RPC_URL);
    expect(call.networkPassphrase).toBe(
      ENV_CONFIGURED.STELLAR_NETWORK_PASSPHRASE,
    );
    expect(call.signTransaction).toBe(signTransactionMock);
  });

  it("invalidates the deposits and LP queries on success", async () => {
    recordWireInMock.mockResolvedValueOnce({ hash: "tx-hash", wireId: null });

    const { result } = renderHook(() => useRecordWireIn(), {
      wrapper: makeWrapper(),
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["lp", 12, "bank-deposits"],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["lp", 12] });
  });

  it("short-circuits when the minter id is unconfigured", async () => {
    envMock = { ...ENV_CONFIGURED, STELLAR_YIELD_MINTER_ID: "" };

    const { result } = renderHook(() => useRecordWireIn(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        /not configured for this environment/,
      );
    });
    expect(recordWireInMock).not.toHaveBeenCalled();
  });

  it("short-circuits when the wallet is not connected", async () => {
    stellarWalletState = {
      address: "",
      isConnected: false,
      signTransaction: signTransactionMock,
    };

    const { result } = renderHook(() => useRecordWireIn(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(
        /wallet not connected/,
      );
    });
    expect(recordWireInMock).not.toHaveBeenCalled();
  });

  it("short-circuits when no receiver could be resolved", async () => {
    const { result } = renderHook(() => useRecordWireIn(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...INPUT, receiver: "" }),
      ).rejects.toThrow(
        /no linked Stellar wallet and no capital wallet is configured/,
      );
    });
    expect(recordWireInMock).not.toHaveBeenCalled();
  });

  it("exposes the stage reported by recordWireIn", async () => {
    recordWireInMock.mockImplementationOnce(
      async ({ onStageChange }: { onStageChange?: (s: string) => void }) => {
        onStageChange?.("awaiting-signature");
        onStageChange?.("submitting");
        onStageChange?.("confirming");
        return { hash: "tx-hash", wireId: null };
      },
    );

    const { result } = renderHook(() => useRecordWireIn(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(INPUT);
    });

    expect(result.current.stage).toBe("confirming");

    act(() => result.current.reset());
    expect(result.current.stage).toBeNull();
  });
});

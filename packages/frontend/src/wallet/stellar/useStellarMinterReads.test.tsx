// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  readWireOut: vi.fn(),
  readPaused: vi.fn(),
  chain: { minterId: "CMINTER" },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  readMinterWireOut: (...a: unknown[]) => h.readWireOut(...a),
  readMinterPaused: (...a: unknown[]) => h.readPaused(...a),
}));
vi.mock("./chain", () => ({
  get minterId() {
    return h.chain.minterId;
  },
  networkPassphrase: "PASS",
  sorobanRpcUrl: "https://rpc",
}));

import {
  useStellarMinterPaused,
  useStellarWireOuts,
} from "./useStellarMinterReads";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.chain.minterId = "CMINTER";
});

describe("useStellarWireOuts", () => {
  it("reads each id and isolates a per-id failure", async () => {
    h.readWireOut.mockImplementation(({ id }: { id: number }) =>
      id === 1
        ? Promise.resolve({
            lp: "G",
            amount: "10",
            requestedAt: 1,
            status: "Pending",
          })
        : Promise.reject(new Error("#10")),
    );
    const { result } = renderHook(() => useStellarWireOuts(["1", "2"]), {
      wrapper,
    });
    await waitFor(() => expect(result.current["1"]?.data?.amount).toBe("10"));
    await waitFor(() =>
      expect(result.current["2"]?.error?.message).toBe("#10"),
    );
    expect(h.readWireOut).toHaveBeenCalledWith({
      minterId: "CMINTER",
      id: 1,
      rpcUrl: "https://rpc",
      networkPassphrase: "PASS",
    });
  });

  it("does not read when disabled or unconfigured", async () => {
    renderHook(() => useStellarWireOuts(["1"], { enabled: false }), {
      wrapper,
    });
    h.chain.minterId = "";
    renderHook(() => useStellarWireOuts(["1"]), { wrapper });
    await Promise.resolve();
    expect(h.readWireOut).not.toHaveBeenCalled();
  });
});

describe("useStellarMinterPaused", () => {
  it("returns the simulated bool", async () => {
    h.readPaused.mockResolvedValue(true);
    const { result } = renderHook(() => useStellarMinterPaused(), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });
});

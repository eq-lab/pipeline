import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  usePositionsHistory,
  type PositionHistoryResponse,
} from "./usePositionsHistory";

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock("./client", () => ({
  apiFetch: mockApiFetch,
}));

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: "evm" }),
  useEvmWallet: () => ({
    address: "0x8493000000000000000000000000000000003b92",
    isConnected: true,
  }),
  useStellarWallet: () => ({ address: undefined, isConnected: false }),
  subscribeMock: () => () => {},
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99000001,
  },
}));

const RESPONSE: PositionHistoryResponse = {
  wallet: "0x8493000000000000000000000000000000003b92",
  vault_address: "0xvault",
  interval: "hourly",
  history: [
    {
      timestamp: "2026-08-17T00:00:00Z",
      shares_balance: "0",
      avg_cost_basis: "0",
      cumulative_realized_pnl: "0",
    },
  ],
};

const CAP_ERROR = new Error(
  "request could produce up to 1200 samples (max 1000); reduce `days` or use a coarser `interval`",
);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function calledPaths(): string[] {
  return mockApiFetch.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe("usePositionsHistory — fixed periods", () => {
  it("7d requests days=7 hourly", async () => {
    mockApiFetch.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => usePositionsHistory("7d"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(calledPaths()[0]).toContain("interval=hourly");
    expect(calledPaths()[0]).toContain("days=7");
  });
});

describe("usePositionsHistory — All interval ladder (#1140)", () => {
  it("starts at hourly and omits days", async () => {
    mockApiFetch.mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => usePositionsHistory("all"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(calledPaths()[0]).toContain("interval=hourly");
    expect(calledPaths()[0]).not.toContain("days=");
  });

  it("falls back to the next rung on the sample-cap 400 and remembers it", async () => {
    mockApiFetch.mockRejectedValueOnce(CAP_ERROR).mockResolvedValue(RESPONSE);
    const { result } = renderHook(() => usePositionsHistory("all"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(calledPaths()[0]).toContain("interval=hourly");
    expect(calledPaths()[1]).toContain("interval=daily");

    mockApiFetch.mockClear();
    mockApiFetch.mockResolvedValue(RESPONSE);
    const { result: second } = renderHook(() => usePositionsHistory("all"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(second.current.data).toBeDefined());
    expect(calledPaths()).toHaveLength(1);
    expect(calledPaths()[0]).toContain("interval=daily");
  });

  it("rethrows non-cap errors without laddering", async () => {
    mockApiFetch.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePositionsHistory("1m"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});

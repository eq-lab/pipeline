// spec: docs/frontend/trustee-flows.md#cash-management--withdrawal-queue (Stellar-scoped chain_id, #1600).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWithdrawalQueue } from "./useWithdrawalQueue";
import type { WithdrawalQueueResponse } from "./useWithdrawalQueue";

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    WALLETCONNECT_PROJECT_ID: "replace-me",
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  },
}));

const sessionChain = vi.hoisted(() => ({
  chainId: 560048 as number | undefined,
}));

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
  useSessionState: () => ({
    status: "authenticated",
    address: "0xabc",
    chainId: sessionChain.chainId,
    error: undefined,
  }),
}));

const FIXTURE: WithdrawalQueueResponse = {
  summary: {
    in_queue_usd: "1250.000000",
    requests_count: 3,
    estimated_wait_days: null,
    liquid_cover: null,
  },
  items: [
    {
      chain_id: 99_000_001,
      account: "GABC",
      amount: "1250.000000",
      status: "Queued",
    },
  ],
};

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return wrapper;
}

beforeEach(() => {
  fetchMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useWithdrawalQueue", () => {
  it("fetches /v1/withdrawal-queue scoped to the chain the trustee signed in with", async () => {
    sessionChain.chainId = 560048;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useWithdrawalQueue(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/withdrawal-queue?chain_id=560048");
    expect(result.current.chainId).toBe(560048);
    expect(result.current.data?.items[0]?.chain_id).toBe(99_000_001);
  });

  it("falls back to the Stellar chain when no session chain is known", async () => {
    sessionChain.chainId = undefined;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useWithdrawalQueue(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/withdrawal-queue?chain_id=99000001");
    expect(result.current.chainId).toBe(99_000_001);
  });

  it("surfaces a non-2xx response as an error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );

    const { result } = renderHook(() => useWithdrawalQueue(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeUndefined();
  });
});

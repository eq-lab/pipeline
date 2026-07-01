/**
 * Tests for `src/api/useWithdrawalQueue.ts`.
 *
 * Covers:
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With no mock key, the hook calls apiFetch with `/v1/withdrawal-queue`.
 *   - Error path: when fetch fails, `error` is populated.
 *   - Always enabled — the hook fires regardless of wallet connection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWithdrawalQueue } from "./useWithdrawalQueue";
import type { WithdrawalQueueResponse } from "./useWithdrawalQueue";

// ── Mock @/wallet (client.ts dependency) ─────────────────────────────────────

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: "evm" }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
  useStellarWallet: () => ({ address: undefined, isConnected: false }),
  subscribeMock: () => () => {},
  readMock: (key: string, parse: (raw: string) => unknown) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      return parse(raw);
    } catch {
      return undefined;
    }
  },
  parseJson: (value: string) => JSON.parse(value) as unknown,
}));

// ── Mock ENV ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_WITH_ITEMS: WithdrawalQueueResponse = {
  summary: {
    in_queue_usd: "1850000.000000",
    requests_count: 6,
    estimated_wait_days: "3.2",
    liquid_cover: null,
  },
  items: [
    {
      account: "0x7a3f2b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f3f",
      amount: "620000.000000",
      status: "Completed",
    },
    {
      account: "0xabcdef1234567890abcdef1234567890abcdef12",
      amount: "480000.000000",
      status: "Queued",
    },
  ],
};

const FIXTURE_EMPTY: WithdrawalQueueResponse = {
  summary: {
    in_queue_usd: "0.000000",
    requests_count: 0,
    estimated_wait_days: null,
    liquid_cover: null,
  },
  items: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── useWithdrawalQueue tests — mock-key path ──────────────────────────────────

describe("useWithdrawalQueue — mock-key path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns fixture data immediately from mock key, never calls fetch", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawal-queue",
      JSON.stringify(FIXTURE_WITH_ITEMS),
    );

    const { result } = renderHook(() => useWithdrawalQueue(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_ITEMS);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty items list from mock key", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawal-queue",
      JSON.stringify(FIXTURE_EMPTY),
    );

    const { result } = renderHook(() => useWithdrawalQueue(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.items).toHaveLength(0);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── useWithdrawalQueue tests — real fetch path ────────────────────────────────

describe("useWithdrawalQueue — real fetch path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("always enabled — fires fetch even with no wallet connected", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_ITEMS), { status: 200 }),
    );

    const { result } = renderHook(() => useWithdrawalQueue(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_ITEMS);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/withdrawal-queue"),
      undefined,
    );
  });

  it("sets error when fetch fails with 500", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
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

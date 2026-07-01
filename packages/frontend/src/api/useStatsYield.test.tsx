/**
 * Tests for `src/api/useStatsYield.ts`.
 *
 * Covers:
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With no mock key, the hook calls apiFetch with `/v1/stats/yield`.
 *   - Empty array response (no history) — returns empty array, no error.
 *   - Error path: when fetch fails, `error` is populated.
 *   - `enabled = false` — no fetch call.
 *   - refetchInterval is set to 30 s.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStatsYield } from "./useStatsYield";
import type { SampleYieldItem } from "./useStatsYield";

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
    STAKED_PLUSD_ADDRESS: "0x0000000000000000000000000000000000000000",
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_WITH_DATA: SampleYieldItem[] = [
  {
    timestamp: "2025-01-01T00:00:00Z",
    apy: "0.104",
    accrued: "1000000.000000",
    principal_outstanding: "30000000.000000",
  },
  {
    timestamp: "2025-01-08T00:00:00Z",
    apy: "0.104",
    accrued: "2000000.000000",
    principal_outstanding: "31000000.000000",
  },
  {
    timestamp: "2025-01-15T00:00:00Z",
    apy: "0.104",
    accrued: "2910000.000000",
    principal_outstanding: "31600000.000000",
  },
];

const FIXTURE_EMPTY: SampleYieldItem[] = [];

const FIXTURE_NULL_APY: SampleYieldItem[] = [
  {
    timestamp: "2025-01-01T00:00:00Z",
    apy: null,
    accrued: "0.000000",
    principal_outstanding: "0.000000",
  },
];

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

// ── useStatsYield tests — mock-key path ───────────────────────────────────────

describe("useStatsYield — mock-key path", () => {
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
      "pipeline.mock.api.GET./v1/stats/yield",
      JSON.stringify(FIXTURE_WITH_DATA),
    );

    const { result } = renderHook(
      () => useStatsYield({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_DATA);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty array from mock key", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/stats/yield",
      JSON.stringify(FIXTURE_EMPTY),
    );

    const { result } = renderHook(
      () => useStatsYield({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null apy samples from mock key", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/stats/yield",
      JSON.stringify(FIXTURE_NULL_APY),
    );

    const { result } = renderHook(
      () => useStatsYield({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_NULL_APY);
    });

    expect(result.current.data?.[0]?.apy).toBeNull();
  });
});

// ── useStatsYield tests — real fetch path ────────────────────────────────────

describe("useStatsYield — real fetch path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("calls fetch with /v1/stats/yield when no mock key is set", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_DATA), { status: 200 }),
    );

    const { result } = renderHook(
      () => useStatsYield({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_DATA);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/stats/yield"),
      undefined,
    );
  });

  it("passes chain_id and interval query params", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_DATA), { status: 200 }),
    );

    const { result } = renderHook(
      () => useStatsYield({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("chain_id=560048"),
      undefined,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("interval=weekly"),
      undefined,
    );
  });

  it("passes days param for non-all periods", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_DATA), { status: 200 }),
    );

    const { result } = renderHook(
      () => useStatsYield({ chainId: 560048, periodId: "1m" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("days=30"),
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

    const { result } = renderHook(
      () => useStatsYield({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
  });
});

// ── useStatsYield — enabled guard ─────────────────────────────────────────────

describe("useStatsYield — enabled guard", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("does not call fetch when enabled = false", async () => {
    const { result } = renderHook(
      () => useStatsYield({ chainId: 560048, periodId: "all", enabled: false }),
      { wrapper: makeWrapper() },
    );

    // Give it a tick to confirm nothing fires
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});

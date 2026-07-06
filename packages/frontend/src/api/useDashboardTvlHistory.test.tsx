/**
 * Tests for `src/api/useDashboardTvlHistory.ts`.
 *
 * Covers:
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With no mock key, the hook calls apiFetch with `/v1/dashboard/tvl-history`.
 *   - URL includes chain_id and interval; days present for non-all periods,
 *     absent for "all".
 *   - Error path: when fetch fails, `error` is populated.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDashboardTvlHistory } from "./useDashboardTvlHistory";
import type { TvlPoint } from "./useDashboardTvlHistory";

// ── Mock @/wallet ─────────────────────────────────────────────────────────────

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

const FIXTURE_WITH_DATA: TvlPoint[] = [
  { timestamp: "2025-01-01T00:00:00Z", tvl: "10000000.000000" },
  { timestamp: "2025-01-08T00:00:00Z", tvl: "20000000.000000" },
  { timestamp: "2025-01-15T00:00:00Z", tvl: "43140000.000000" },
];

const FIXTURE_EMPTY: TvlPoint[] = [];

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

// ── useDashboardTvlHistory — mock-key path ────────────────────────────────────

describe("useDashboardTvlHistory — mock-key path", () => {
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
      "pipeline.mock.api.GET./v1/dashboard/tvl-history",
      JSON.stringify(FIXTURE_WITH_DATA),
    );

    const { result } = renderHook(
      () => useDashboardTvlHistory({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_DATA);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty array from mock key", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/dashboard/tvl-history",
      JSON.stringify(FIXTURE_EMPTY),
    );

    const { result } = renderHook(
      () => useDashboardTvlHistory({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── useDashboardTvlHistory — real fetch path ──────────────────────────────────

describe("useDashboardTvlHistory — real fetch path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("calls fetch with /v1/dashboard/tvl-history when no mock key is set", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_DATA), { status: 200 }),
    );

    const { result } = renderHook(
      () => useDashboardTvlHistory({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_DATA);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/dashboard/tvl-history"),
      undefined,
    );
  });

  it("passes chain_id and interval query params", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_DATA), { status: 200 }),
    );

    const { result } = renderHook(
      () => useDashboardTvlHistory({ chainId: 560048, periodId: "all" }),
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

  it("omits days param for 'all' period", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_DATA), { status: 200 }),
    );

    const { result } = renderHook(
      () => useDashboardTvlHistory({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).not.toContain("days=");
  });

  it("passes days param for non-all periods", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_DATA), { status: 200 }),
    );

    const { result } = renderHook(
      () => useDashboardTvlHistory({ chainId: 560048, periodId: "1m" }),
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
      () => useDashboardTvlHistory({ chainId: 560048, periodId: "all" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
  });
});

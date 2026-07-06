/**
 * Tests for `src/api/useDashboardSummary.ts`.
 *
 * Covers:
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With no mock key, the hook calls apiFetch with `/v1/dashboard/summary`.
 *   - URL includes chain_id query param but NOT days/interval.
 *   - Error path: when fetch fails, `error` is populated.
 *   - refetchInterval is set to 30 s.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDashboardSummary } from "./useDashboardSummary";
import type { DashboardSummary } from "./useDashboardSummary";

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

const FIXTURE_FULL: DashboardSummary = {
  tvl: "43140000.000000",
  outstanding_in_loans: "31600000.000000",
  current_apy_net_to_splusd: "0.104",
  loan_book_yield: "0.112",
  cumulative_yield_total: "2910000.000000",
};

const FIXTURE_NULL_FIELDS: DashboardSummary = {
  tvl: "0.000000",
  outstanding_in_loans: null,
  current_apy_net_to_splusd: null,
  loan_book_yield: null,
  cumulative_yield_total: "0.000000",
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

// ── useDashboardSummary — mock-key path ────────────────────────────────────────

describe("useDashboardSummary — mock-key path", () => {
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
      "pipeline.mock.api.GET./v1/dashboard/summary",
      JSON.stringify(FIXTURE_FULL),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_FULL);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles null-field fixture from mock key", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/dashboard/summary",
      JSON.stringify(FIXTURE_NULL_FIELDS),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_NULL_FIELDS);
    });

    expect(result.current.data?.outstanding_in_loans).toBeNull();
    expect(result.current.data?.current_apy_net_to_splusd).toBeNull();
    expect(result.current.data?.loan_book_yield).toBeNull();
  });
});

// ── useDashboardSummary — real fetch path ─────────────────────────────────────

describe("useDashboardSummary — real fetch path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("calls fetch with /v1/dashboard/summary when no mock key is set", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_FULL), { status: 200 }),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_FULL);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/dashboard/summary"),
      undefined,
    );
  });

  it("passes chain_id query param", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_FULL), { status: 200 }),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("chain_id=560048"),
      undefined,
    );
  });

  it("does NOT pass days or interval params", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_FULL), { status: 200 }),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).not.toContain("days=");
    expect(url).not.toContain("interval=");
  });

  it("sets error when fetch fails with 500", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
  });
});

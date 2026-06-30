/**
 * Tests for `src/api/useLoanBook.ts`.
 *
 * Covers:
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With no mock key, the hook calls apiFetch with `/v1/loan-book`.
 *   - Error path: when fetch fails, `error` is populated.
 *   - Always enabled — the hook fires regardless of wallet connection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanBook } from "./useLoanBook";
import type { LoanBookResponse } from "./useLoanBook";

// ── Mock @/wallet (client.ts dependency) ─────────────────────────────────────

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: "evm" }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
  useStellarWallet: () => ({ address: undefined, isConnected: false }),
  subscribeMock: () => () => {},
  // readMock reads from localStorage (jsdom provides this in the test environment)
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

const FIXTURE_WITH_LOANS: LoanBookResponse = {
  summary: {
    total_deployed: "31600000.000000",
    total_collateral: null,
    senior_debt_coverage: null,
    avg_yield: "0.112000",
    avg_duration_days: 68,
  },
  loans: [
    {
      originator: "Open Mineral",
      borrower: "Open Mineral",
      commodity: "Copper Concentrate",
      principal: "8000000.000000",
      collateral: null,
      ltv: null,
      duration_days: 120,
      rate: "0.112000",
      protection: "LC at sight",
      status: "Performing",
    },
  ],
};

const FIXTURE_EMPTY: LoanBookResponse = {
  summary: {
    total_deployed: "0.000000",
    total_collateral: null,
    senior_debt_coverage: null,
    avg_yield: null,
    avg_duration_days: null,
  },
  loans: [],
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

// ── useLoanBook tests — mock-key path ─────────────────────────────────────────

describe("useLoanBook — mock-key path", () => {
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
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_WITH_LOANS),
    );

    const { result } = renderHook(() => useLoanBook(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_LOANS);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty loan list from mock key", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_EMPTY),
    );

    const { result } = renderHook(() => useLoanBook(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.loans).toHaveLength(0);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── useLoanBook tests — real fetch path ───────────────────────────────────────

describe("useLoanBook — real fetch path", () => {
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
      new Response(JSON.stringify(FIXTURE_WITH_LOANS), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanBook(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_LOANS);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/loan-book"),
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

    const { result } = renderHook(() => useLoanBook(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
  });
});

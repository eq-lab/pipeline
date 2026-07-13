/**
 * Tests for `src/api/useLoanBook.ts` (issue #843).
 *
 * Covers (mirrors `-useLoanSubmissions.test.tsx`):
 *   - The request URL is `/v1/loan-book?chain_id=99000001` (Stellar-scoped).
 *   - The bearer header is attached (via apiFetch/sessionStore).
 *   - Success returns the parsed LoanBookResponse.
 *   - Error path populates `error`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanBook } from "./useLoanBook";
import type { LoanBookResponse } from "./useLoanBook";

// ── Mock @/lib/env ────────────────────────────────────────────────────────────

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

// ── Mock @/auth/sessionStore (apiFetch reads the bearer token from here) ──────

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE: LoanBookResponse = {
  summary: {
    total_deployed: "100000.000000",
    total_collateral: null,
    senior_debt_coverage: null,
    avg_yield: null,
    avg_duration_days: null,
    deployed_senior: "96000.000000",
    weighted_rate: "0.131000",
    weighted_tenor_days: 148,
    at_risk_wl_and_default_senior: "4850.000000",
    at_risk_wl_and_default_pct: "0.0430",
    top_concentration: { commodity: "Cocoa", share: "0.0720" },
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

beforeEach(() => {
  fetchMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── useLoanBook ────────────────────────────────────────────────────────────────

describe("useLoanBook", () => {
  it("calls fetch with /v1/loan-book and chain_id=99000001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanBook(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book");
    expect(url).toContain("chain_id=99000001");
  });

  it("attaches the Authorization bearer header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanBook(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("returns parsed data on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanBook(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
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

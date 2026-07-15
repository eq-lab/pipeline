/**
 * Tests for `src/api/useLoanFinancials.ts` (issue #852). Mirrors
 * `-useLoanValuation.test.tsx`:
 *   - The request URL is `/v1/loan-book/{loan_id}/financials?chain_id=99000001`.
 *   - The bearer header is attached (via apiFetch/sessionStore).
 *   - Success returns the parsed LoanFinancialsResponse.
 *   - Error path populates `error`.
 *   - The query is disabled (no fetch) while the loan id is empty.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanFinancials } from "./useLoanFinancials";
import type { LoanFinancialsResponse } from "./useLoanFinancials";

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

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
}));

// ── Fixture ─────────────────────────────────────────────────────────────────

const FIXTURE: LoanFinancialsResponse = {
  loan_id: "4488",
  status: "Performing",
  location: {
    location_type: "Vessel",
    location_identifier: "MV Andes",
    tracking_url: "",
    updated_at: "2026-06-01T00:00:00Z",
  },
  offtaker: "6300.000000",
  principal: "4800.000000",
  interest: "231.000000",
  fees: "69.000000",
  minted_yield: "115.500000",
  not_minted_yield: "115.500000",
  offtaker_outstanding: "0.000000",
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

describe("useLoanFinancials", () => {
  it("calls fetch with /v1/loan-book/{id}/financials and chain_id=99000001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanFinancials("4488"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book/4488/financials");
    expect(url).toContain("chain_id=99000001");
  });

  it("attaches the Authorization bearer header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanFinancials("4488"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("sets error when fetch fails with 404", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        statusText: "Not Found",
      }),
    );

    const { result } = renderHook(() => useLoanFinancials("4488"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
  });

  it("does not fetch while the loan id is empty (disabled query)", () => {
    const { result } = renderHook(() => useLoanFinancials(""), {
      wrapper: makeWrapper(),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

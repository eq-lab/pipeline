/**
 * Tests for `src/api/useLoanValuation.ts` (issue #845).
 *
 * Covers (mirrors `-useLoanBook.test.tsx`):
 *   - The request URL is `/v1/loan-book/{loanId}/valuations?chain_id=99000001`.
 *   - The bearer header is attached.
 *   - Success returns the parsed CollateralValuationResponse.
 *   - A 404 (no valuation anchor) populates `error`.
 *   - The query is disabled for an empty loanId (no fetch).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanValuation } from "./useLoanValuation";
import type { CollateralValuationResponse } from "./useLoanValuation";

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

const FIXTURE: CollateralValuationResponse = {
  chain_id: 99_000_001,
  loan_id: "1",
  commodity: "Lithium",
  valuation_mode: "StandardGoods",
  inputs: {
    haircut_pct: "10",
    reference_price_asset: "Li2CO3",
    price_provider: "provider-x",
    reference_price: "10450.00",
    quantity_dmt: "620",
  },
  collateral_value: "5831100.00",
  ccr: {
    collateral_value: "5831100.00",
    outstanding_senior_principal: "4300000.00",
    ccr_bps: 13_500,
    ccr_pct: "135.00",
  },
  missing_inputs: [],
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

describe("useLoanValuation", () => {
  it("calls /v1/loan-book/{loanId}/valuations with chain_id=99000001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanValuation("1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book/1/valuations");
    expect(url).toContain("chain_id=99000001");
  });

  it("attaches the Authorization bearer header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanValuation("1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("sets error on a 404 (no valuation anchor)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        statusText: "Not Found",
      }),
    );

    const { result } = renderHook(() => useLoanValuation("999"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch for an empty loanId (disabled)", () => {
    renderHook(() => useLoanValuation(""), { wrapper: makeWrapper() });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

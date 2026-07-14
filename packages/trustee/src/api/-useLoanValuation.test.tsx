/**
 * Tests for `src/api/useLoanValuation.ts` (issues #845 / #847). Mirrors
 * `-useLoanBook.test.tsx`:
 *   - The request URL is `/v1/loan-book/{loan_id}/valuations?chain_id=99000001`.
 *   - The bearer header is attached (via apiFetch/sessionStore).
 *   - Success returns the parsed LoanValuationResponse.
 *   - Error path populates `error`.
 *   - The query is disabled (no fetch) while the loan id is empty.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanValuation } from "./useLoanValuation";
import type { LoanValuationResponse } from "./useLoanValuation";

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

const FIXTURE: LoanValuationResponse = {
  chain_id: 99_000_001,
  loan_id: "4488",
  commodity: "Lithium Carbonate",
  valuation_mode: "MetalConcentrate",
  inputs: {
    haircut_pct: "0.10",
    reference_price_asset: "Li2CO3",
    price_provider: "coingecko",
    reference_price: "10450",
    quantity_dmt: "620",
    moisture_pct: null,
    metals: [],
    penalties: [],
    treatment_charge_per_dmt: null,
    realisation_costs: null,
    quotational_period: null,
    pricing_reference: null,
    incoterm: null,
    assay_status: null,
    assay_certificate_uri: null,
  },
  waterfall: null,
  collateral_value: "5831100.00",
  ccr: {
    collateral_value: "5831100.00",
    outstanding_senior_principal: "4950000.00",
    ccr_bps: 11_780,
    ccr_pct: "117.80",
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
  it("calls fetch with /v1/loan-book/{id}/valuations and chain_id=99000001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanValuation("4488"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book/4488/valuations");
    expect(url).toContain("chain_id=99000001");
  });

  it("attaches the Authorization bearer header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanValuation("4488"), {
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

    const { result } = renderHook(() => useLoanValuation("4488"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
  });

  it("does not fetch while the loan id is empty (disabled query)", () => {
    const { result } = renderHook(() => useLoanValuation(""), {
      wrapper: makeWrapper(),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

/**
 * Tests for `src/api/useCollateralValuation.ts` (issue #816).
 *
 * Covers:
 *   - The request URL includes `/v1/loan-book/<id>/valuations` and
 *     `chain_id=99000001`.
 *   - The bearer header is attached (via apiFetch/sessionStore).
 *   - Success returns the parsed `CollateralValuationResponse`.
 *   - A 404 is treated as a non-error "no valuation yet" outcome
 *     (`notFound: true`), never surfaced as a thrown/error state.
 *   - `enabled=false` skips the fetch entirely.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCollateralValuation } from "./useCollateralValuation";
import type { CollateralValuationResponse } from "./useCollateralValuation";

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

const FIXTURE_RESPONSE: CollateralValuationResponse = {
  chain_id: 99_000_001,
  loan_id: "7",
  commodity: "Gold pyrite concentrate",
  valuation_mode: "MetalConcentrate",
  inputs: {
    haircut_pct: "25",
    reference_price_asset: "XAU",
    price_provider: "chainlink",
    reference_price: "2410.00",
    quantity_dmt: "3400",
    moisture_pct: "8.2",
    metals: [],
    penalties: [],
    treatment_charge_per_dmt: "145",
    realisation_costs: "20000",
    quotational_period: "M+1",
    pricing_reference: null,
    incoterm: null,
    assay_status: "Final",
    assay_certificate_uri: null,
  },
  waterfall: {
    gross_value: "7491700.00",
    treatment_charge: "493000.00",
    refining_charge: "20000.00",
    penalties: "41000.00",
    nsr: "6937700.00",
    realisation_costs: "310000.00",
    mine_gate_value: "6627700.00",
    collateral_value: "4970800.00",
  },
  collateral_value: "4970800.00",
  ccr: {
    collateral_value: "4970800.00",
    outstanding_senior_principal: "2800000.00",
    ccr_bps: 17753,
    ccr_pct: "177.53",
  },
  missing_inputs: [],
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

// ── useCollateralValuation ────────────────────────────────────────────────────

describe("useCollateralValuation", () => {
  it("calls fetch with /v1/loan-book/<id>/valuations and chain_id=99000001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => useCollateralValuation(7, true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_RESPONSE);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book/7/valuations");
    expect(url).toContain("chain_id=99000001");
  });

  it("attaches the Authorization bearer header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => useCollateralValuation(7, true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_RESPONSE);
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("returns parsed data on success with notFound false", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => useCollateralValuation(7, true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_RESPONSE);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.notFound).toBe(false);
  });

  it("treats a 404 as a non-error 'no valuation yet' outcome", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "no valuation for loan 7" }), {
        status: 404,
        statusText: "Not Found",
      }),
    );

    const { result } = renderHook(() => useCollateralValuation(7, true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.notFound).toBe(true);
  });

  it("treats a 500 the same as a 404 — no scary error state, just 'no valuation'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useCollateralValuation(7, true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.notFound).toBe(true);
  });

  it("does not fetch when enabled=false", () => {
    const { result } = renderHook(() => useCollateralValuation(7, false), {
      wrapper: makeWrapper(),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.notFound).toBe(false);
  });
});

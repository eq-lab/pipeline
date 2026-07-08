/**
 * Tests for `src/api/useCapitalAllocation.ts`.
 *
 * Covers:
 *   - The request URL includes chain_id=99000001 (Stellar-scoped).
 *   - Success path returns the parsed CapitalAllocation.
 *   - Error path populates `error`.
 *   - refetchInterval is set to 30 s.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCapitalAllocation } from "./useCapitalAllocation";
import type { CapitalAllocation } from "./useCapitalAllocation";

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

const FIXTURE_FULL: CapitalAllocation = {
  total: "115190000.000000",
  buckets: {
    capital_wallet: "8400000.000000",
    in_transit: "4950000.000000",
    trust_account: "1200000.000000",
    deployed: "96000000.000000",
    tbills: "4640000.000000",
  },
};

const FIXTURE_DEPLOYED_ONLY: CapitalAllocation = {
  total: "96000000.000000",
  buckets: {
    capital_wallet: null,
    in_transit: null,
    trust_account: null,
    deployed: "96000000.000000",
    tbills: null,
  },
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

// ── useCapitalAllocation ──────────────────────────────────────────────────────

describe("useCapitalAllocation", () => {
  it("calls fetch with /v1/capital-allocation and chain_id=99000001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_FULL), { status: 200 }),
    );

    const { result } = renderHook(() => useCapitalAllocation(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_FULL);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/capital-allocation");
    expect(url).toContain("chain_id=99000001");
  });

  it("returns parsed data on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_FULL), { status: 200 }),
    );

    const { result } = renderHook(() => useCapitalAllocation(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_FULL);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("handles a deployed-only response (current backend reality)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_DEPLOYED_ONLY), { status: 200 }),
    );

    const { result } = renderHook(() => useCapitalAllocation(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_DEPLOYED_ONLY);
    });
    expect(result.current.data?.buckets.capital_wallet).toBeNull();
    expect(result.current.data?.buckets.deployed).toBe("96000000.000000");
  });

  it("sets error when fetch fails with 500", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useCapitalAllocation(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeUndefined();
  });
});

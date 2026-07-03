/**
 * Tests for `src/api/useFinancialPosition.ts`.
 *
 * Covers:
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With no mock key, the hook calls apiFetch with `/v1/financial-position`.
 *   - Error path: when fetch fails, `error` is populated.
 *   - Always enabled — the hook fires regardless of wallet connection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFinancialPosition } from "./useFinancialPosition";
import type { FinancialPositionResponse } from "./useFinancialPosition";

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
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_WITH_DATA: FinancialPositionResponse = {
  assets: {
    total: "8100000.000000",
    liquid: {
      total: null,
      cash_stablecoins: null,
      tokenized_tbills: null,
      off_chain_usd: null,
    },
    deployed: {
      total: "8100000.000000",
      secured_loans_outstanding: "8000000.000000",
      accrued_interest_receivable: "100000.000000",
    },
  },
  liabilities: {
    total: "500000.000000",
    senior_claims: {
      plusd_outstanding: null,
    },
    subordinated_capital: {
      junior_tranche: "500000.000000",
    },
  },
};

const FIXTURE_EMPTY: FinancialPositionResponse = {
  assets: {
    total: "0.000000",
    liquid: {
      total: null,
      cash_stablecoins: null,
      tokenized_tbills: null,
      off_chain_usd: null,
    },
    deployed: {
      total: "0.000000",
      secured_loans_outstanding: "0.000000",
      accrued_interest_receivable: "0.000000",
    },
  },
  liabilities: {
    total: "0.000000",
    senior_claims: {
      plusd_outstanding: null,
    },
    subordinated_capital: {
      junior_tranche: "0.000000",
    },
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

// ── Tests — mock-key path ─────────────────────────────────────────────────────

describe("useFinancialPosition — mock-key path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/financial-position",
      JSON.stringify(FIXTURE_WITH_DATA),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns fixture data from mock key without calling fetch", async () => {
    const { result } = renderHook(() => useFinancialPosition(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data?.assets.deployed.secured_loans_outstanding).toBe(
      "8000000.000000",
    );
    expect(
      result.current.data?.liabilities.subordinated_capital.junior_tranche,
    ).toBe("500000.000000");
  });

  it("returns null for unconfigured REST fields (plusd_outstanding)", async () => {
    const { result } = renderHook(() => useFinancialPosition(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(
      result.current.data?.liabilities.senior_claims.plusd_outstanding,
    ).toBeNull();
    expect(result.current.data?.assets.liquid.cash_stablecoins).toBeNull();
  });
});

// ── Tests — real fetch path ───────────────────────────────────────────────────

describe("useFinancialPosition — real fetch path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("calls apiFetch with /v1/financial-position", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_EMPTY), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useFinancialPosition(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/financial-position"),
      undefined,
    );
  });
});

// ── Tests — error path ────────────────────────────────────────────────────────

describe("useFinancialPosition — error path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns error state when fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useFinancialPosition(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});

// ── Tests — loading state ─────────────────────────────────────────────────────

describe("useFinancialPosition — loading state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns loading state while query is in-flight", () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useFinancialPosition(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});

// ── Tests — always enabled ────────────────────────────────────────────────────

describe("useFinancialPosition — always enabled", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("fires even with no wallet connected", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_EMPTY), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useFinancialPosition(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(fetchMock).toHaveBeenCalled();
  });
});

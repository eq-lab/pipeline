/**
 * Tests for `src/api/useStats.ts`.
 *
 * Covers:
 *   - `formatApy` helper: fraction → percentage string, null/undefined → "—".
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With no mock key, the hook calls apiFetch with `/v1/stats`.
 *   - When APY is null in the response, `formatApy` returns "—".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStats, formatApy } from "./useStats";
import type { StatsResponse } from "./useStats";

// ── Mock wagmi / AppKit ───────────────────────────────────────────────────────

vi.mock("wagmi", async (importOriginal) => {
  const original = await importOriginal<typeof import("wagmi")>();
  return {
    ...original,
    WagmiProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useAccount: vi.fn(() => ({ address: undefined, isConnected: false })),
    useChainId: vi.fn(() => 560048),
    useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
    useReadContract: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: null,
    })),
    useWriteContract: vi.fn(() => ({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
      reset: vi.fn(),
    })),
  };
});

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock("@/wallet/config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
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

const FIXTURE_WITH_APY: StatsResponse = {
  vaults: [
    {
      vault_address: "0xabcdef0000000000000000000000000000000001",
      share_price: "1.05",
      apy: "0.0842",
    },
  ],
};

const FIXTURE_NULL_APY: StatsResponse = {
  vaults: [
    {
      vault_address: "0xabcdef0000000000000000000000000000000001",
      share_price: "1.05",
      apy: null,
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const fetchSpy = fetchMock;

/** Create a fresh QueryClient per test to avoid cache bleeding. */
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

// ── formatApy unit tests ──────────────────────────────────────────────────────

describe("formatApy", () => {
  it("formats a decimal fraction as a percentage string", () => {
    expect(formatApy("0.0842")).toBe("8.42%");
  });

  it("formats zero correctly", () => {
    expect(formatApy("0")).toBe("0.00%");
  });

  it("handles fractional percentages", () => {
    expect(formatApy("0.0725")).toBe("7.25%");
  });

  it("returns em-dash for null", () => {
    expect(formatApy(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatApy(undefined)).toBe("—");
  });

  it("returns em-dash for non-numeric string", () => {
    expect(formatApy("not-a-number")).toBe("—");
  });
});

// ── useStats hook tests ───────────────────────────────────────────────────────

describe("useStats — mock-key path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns fixture data immediately from mock key, never calls fetch", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/stats",
      JSON.stringify(FIXTURE_WITH_APY),
    );

    const { result } = renderHook(() => useStats(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_APY);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null APY from mock key", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/stats",
      JSON.stringify(FIXTURE_NULL_APY),
    );

    const { result } = renderHook(() => useStats(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_NULL_APY);
    });

    // formatApy of null should be "—"
    expect(formatApy(result.current.data?.vaults[0]?.apy)).toBe("—");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useStats — real fetch path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("calls fetch with /v1/stats when no mock key is set", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_WITH_APY), { status: 200 }),
    );

    const { result } = renderHook(() => useStats(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_WITH_APY);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/stats"),
      undefined,
    );
  });

  it("sets error when fetch fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useStats(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
  });
});

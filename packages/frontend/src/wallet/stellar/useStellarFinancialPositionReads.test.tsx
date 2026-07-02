/**
 * Tests for `useStellarPlusdTotalSupply` and `useStellarUsdcReserveBalance`.
 *
 * Both hooks now use Horizon REST API (not Soroban simulation). No mock-layer
 * localStorage keys are set — tests exercise the real fetch path and the
 * unconfigured short-circuit.
 *
 * Scenarios:
 *   useStellarPlusdTotalSupply:
 *     1. Returns `undefined` immediately when `plusdIssuerId` is empty — no fetch.
 *     2. Fetches Horizon /assets and returns `balances.authorized` as a string.
 *     3. Surfaces error when Horizon fetch fails (non-2xx).
 *     4. Returns data without a connected wallet (no wallet gate).
 *
 *   useStellarUsdcReserveBalance:
 *     5. Returns `undefined` immediately when `reserveAccountId` is empty — no fetch.
 *     6. Fetches Horizon /accounts and returns the USDC balance string.
 *     7. Returns "0.0000000" when the account holds no USDC trustline.
 *     8. Surfaces error when Horizon fetch fails (non-2xx).
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStellarPlusdTotalSupply,
  useStellarUsdcReserveBalance,
} from "./useStellarFinancialPositionReads";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// ── Mock chain constants ───────────────────────────────────────────────────────

const ISSUER_ID = "GB4OHB76JOBQAISRNXU7V5U6KOZGHDKTDDMQRZZS2OLLOCVC7WANZMHH";
const RESERVE_ID = "GAD7YKWKWLZSDKVL2D5FRGKI7IE3PBGN7XNCJQJJH7XCGYEAWXR5FISM";
const HORIZON_URL = "https://horizon-futurenet.stellar.org";

let mockPlusdIssuerId = ISSUER_ID;
let mockReserveAccountId = RESERVE_ID;
let mockHorizonUrl = HORIZON_URL;

vi.mock("./chain", () => ({
  get plusdIssuerId() {
    return mockPlusdIssuerId;
  },
  get reserveAccountId() {
    return mockReserveAccountId;
  },
  get horizonUrl() {
    return mockHorizonUrl;
  },
}));

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  mockPlusdIssuerId = ISSUER_ID;
  mockReserveAccountId = RESERVE_ID;
  mockHorizonUrl = HORIZON_URL;
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── Tests: useStellarPlusdTotalSupply ─────────────────────────────────────────

describe("useStellarPlusdTotalSupply", () => {
  it("returns undefined immediately when plusdIssuerId is empty (no fetch)", () => {
    mockPlusdIssuerId = "";

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches Horizon /assets and returns balances.authorized as a string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [{ balances: { authorized: "10000711.9961018" } }],
        },
      }),
    });

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe("10000711.9961018");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, unknown];
    expect(url).toContain("/assets");
    expect(url).toContain("PLUSD");
    expect(url).toContain(encodeURIComponent(ISSUER_ID));
  });

  it("surfaces error when Horizon returns a non-2xx status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/503/);
  });

  it("returns data without a connected wallet (no wallet gate)", async () => {
    // No wallet state set — hook must work regardless.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [{ balances: { authorized: "5000000.0000000" } }],
        },
      }),
    });

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe("5000000.0000000");
    });
  });
});

// ── Tests: useStellarUsdcReserveBalance ───────────────────────────────────────

describe("useStellarUsdcReserveBalance", () => {
  it("returns undefined immediately when reserveAccountId is empty (no fetch)", () => {
    mockReserveAccountId = "";

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches Horizon /accounts and returns the USDC balance string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [
          { balance: "0.0000000", asset_type: "native" },
          {
            balance: "1989988801.0000000",
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer:
              "GB4OHB76JOBQAISRNXU7V5U6KOZGHDKTDDMQRZZS2OLLOCVC7WANZMHH",
          },
        ],
      }),
    });

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe("1989988801.0000000");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, unknown];
    expect(url).toContain("/accounts/");
    expect(url).toContain(encodeURIComponent(RESERVE_ID));
  });

  it("returns '0.0000000' when the account holds no USDC trustline", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [{ balance: "100.0000000", asset_type: "native" }],
      }),
    });

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe("0.0000000");
    });
  });

  it("surfaces error when Horizon returns a non-2xx status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/404/);
  });
});

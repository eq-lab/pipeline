/**
 * Tests for `useStellarPlusdTotalSupply` and `useStellarUsdcCustodyBalance`.
 *
 * `useStellarPlusdTotalSupply` uses Horizon REST (/assets).
 * `useStellarUsdcCustodyBalance` uses a direct Soroban contract call via
 * `createTokenClient(usdcId).balance(usdcCustodyId)`.
 *
 * No localStorage mock keys are set — tests exercise real paths and the
 * unconfigured short-circuit.
 *
 * Scenarios:
 *   useStellarPlusdTotalSupply:
 *     1. Returns `undefined` immediately when `plusdIssuerId` is empty — no fetch.
 *     2. Fetches Horizon /assets and returns `balances.authorized` as a string.
 *     3. Surfaces error when Horizon fetch fails (non-2xx).
 *     4. Returns data without a connected wallet (no wallet gate).
 *
 *   useStellarUsdcCustodyBalance:
 *     5. Returns `undefined` immediately when `usdcId` is empty — no RPC call.
 *     6. Returns `undefined` immediately when `usdcCustodyId` is empty — no RPC call.
 *     7. Calls `createTokenClient(usdcId).balance(usdcCustodyId)` and returns the raw bigint.
 *     8. Returns `undefined` (sentinel guard) when balance equals i64 max.
 *     9. Surfaces error when the Soroban call throws.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStellarPlusdTotalSupply,
  useStellarUsdcCustodyBalance,
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
const USDC_CONTRACT_ID =
  "CBSUIUCCJKYOAMDYDJHQUJRVOGZIMBBTHWQDOEOZOM4KAMCBKYBP7PLI";
const CUSTODY_ID = "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM";
const HORIZON_URL = "https://horizon-futurenet.stellar.org";

let mockPlusdIssuerId = ISSUER_ID;
let mockUsdcId = USDC_CONTRACT_ID;
let mockUsdcCustodyId = CUSTODY_ID;
let mockHorizonUrl = HORIZON_URL;

vi.mock("./chain", () => ({
  get plusdIssuerId() {
    return mockPlusdIssuerId;
  },
  get usdcId() {
    return mockUsdcId;
  },
  get usdcCustodyId() {
    return mockUsdcCustodyId;
  },
  get horizonUrl() {
    return mockHorizonUrl;
  },
}));

// ── Mock TokenClient ──────────────────────────────────────────────────────────

const mockBalance = vi.fn<(account: string) => Promise<bigint>>();

vi.mock("./contracts/token", () => ({
  createTokenClient: (contractId: string) => {
    if (!contractId) return null;
    return { balance: mockBalance };
  },
}));

// ── fetch mock (for Horizon) ──────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  mockPlusdIssuerId = ISSUER_ID;
  mockUsdcId = USDC_CONTRACT_ID;
  mockUsdcCustodyId = CUSTODY_ID;
  mockHorizonUrl = HORIZON_URL;
  vi.stubGlobal("fetch", mockFetch);
  mockBalance.mockReset();
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

// ── Tests: useStellarUsdcCustodyBalance ───────────────────────────────────────

describe("useStellarUsdcCustodyBalance", () => {
  it("returns undefined immediately when usdcId is empty (no RPC call)", () => {
    mockUsdcId = "";

    const { result } = renderHook(() => useStellarUsdcCustodyBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockBalance).not.toHaveBeenCalled();
  });

  it("returns undefined immediately when usdcCustodyId is empty (no RPC call)", () => {
    mockUsdcCustodyId = "";

    const { result } = renderHook(() => useStellarUsdcCustodyBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockBalance).not.toHaveBeenCalled();
  });

  it("calls createTokenClient(usdcId).balance(usdcCustodyId) and returns raw bigint", async () => {
    const expectedBalance = 100_000_000n; // 10 USDC at 7-decimal scale

    mockBalance.mockResolvedValueOnce(expectedBalance);

    const { result } = renderHook(() => useStellarUsdcCustodyBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(expectedBalance);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockBalance).toHaveBeenCalledOnce();
    expect(mockBalance).toHaveBeenCalledWith(CUSTODY_ID);
  });

  it("returns undefined (sentinel guard) when balance equals i64 max", async () => {
    // i64 max — returned by SAC balance() on an issuer account
    const I64_MAX = 9223372036854775807n;
    mockBalance.mockResolvedValueOnce(I64_MAX);

    const { result } = renderHook(() => useStellarUsdcCustodyBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/sentinel/);
  });

  it("surfaces error when the Soroban balance() call throws", async () => {
    mockBalance.mockRejectedValueOnce(
      new Error("TokenClient simulation error: contract not found"),
    );

    const { result } = renderHook(() => useStellarUsdcCustodyBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/contract not found/);
  });

  it("returns zero for a custody account holding no USDC", async () => {
    mockBalance.mockResolvedValueOnce(0n);

    const { result } = renderHook(() => useStellarUsdcCustodyBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(0n);
    });

    expect(result.current.error).toBeNull();
  });
});

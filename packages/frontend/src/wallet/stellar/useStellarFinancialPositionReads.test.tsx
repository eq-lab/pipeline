/**
 * Tests for `useStellarPlusdTotalSupply` and `useStellarUsdcReserveBalance`.
 *
 * Scenarios:
 *   useStellarPlusdTotalSupply:
 *     1. Mock-key fast-path returns raw bigint without RPC.
 *     2. Unconfigured id (plusdId = "") → returns { data: undefined } immediately, no RPC.
 *     3. Ready state with mock data.
 *     4. Error when RPC fails.
 *     5. No wallet gate — returns data even with no wallet connected.
 *
 *   useStellarUsdcReserveBalance:
 *     6. Mock-key fast-path returns raw bigint without RPC.
 *     7. Unconfigured (either id empty) → returns { data: undefined }, no RPC.
 *     8. Ready state with mock data.
 *     9. Error when RPC fails.
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

const PLUSD_ID = "CBVAYH66RIGA5PKSGHKKGOOQDUPKNVFYBW6P7CGMDX4SD7BI7TXUXSKI";
const USDC_ID = "CBSUIUCCJKYOAMDYDJHQUJRVOGZIMBBTHWQDOEOZOM4KAMCBKYBP7PLI";
const RESERVE_ID = "CCYQKUAZ7BF22OMXNPF7RJ2D3PDUNV66S3O2L54UYHDYQ4CLMTJHLNWU";

// These are controlled via vi.mock factories — overridden per test via module re-mock
let mockPlusdId = PLUSD_ID;
let mockUsdcId = USDC_ID;
let mockReserveAccountId = RESERVE_ID;

vi.mock("./chain", () => ({
  get plusdId() {
    return mockPlusdId;
  },
  get usdcId() {
    return mockUsdcId;
  },
  get reserveAccountId() {
    return mockReserveAccountId;
  },
}));

// ── Mock TokenClient ──────────────────────────────────────────────────────────

const mockTotalSupply = vi.fn();
const mockBalance = vi.fn();

vi.mock("./contracts/token", () => ({
  createTokenClient: vi.fn((id: string) => {
    if (!id) return null;
    return { totalSupply: mockTotalSupply, balance: mockBalance };
  }),
}));

// ── Mock evm/mock for useMock / parseBigInt ───────────────────────────────────

vi.mock("../evm/mock", () => ({
  useMock: (key: string, parse: (raw: string) => unknown) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      return parse(raw);
    } catch {
      return undefined;
    }
  },
  readMock: (key: string, parse: (raw: string) => unknown) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      return parse(raw);
    } catch {
      return undefined;
    }
  },
  parseBigInt: (raw: string): bigint => BigInt(raw),
}));

// ── Tests: useStellarPlusdTotalSupply ─────────────────────────────────────────

describe("useStellarPlusdTotalSupply", () => {
  beforeEach(() => {
    localStorage.clear();
    mockTotalSupply.mockClear();
    mockPlusdId = PLUSD_ID;
    mockUsdcId = USDC_ID;
    mockReserveAccountId = RESERVE_ID;
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns data from mock key without making any RPC call", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.plusd.totalSupply",
      "431400000000000",
    );

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBe(431_400_000_000_000n);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockTotalSupply).not.toHaveBeenCalled();
  });

  it("returns undefined immediately when plusdId is empty (no RPC)", () => {
    mockPlusdId = "";

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockTotalSupply).not.toHaveBeenCalled();
  });

  it("returns data from the RPC client in ready state", async () => {
    mockTotalSupply.mockResolvedValue(200_000_000_000n);

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(200_000_000_000n);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces error when RPC fails", async () => {
    mockTotalSupply.mockRejectedValue(new Error("RPC unavailable"));

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/RPC unavailable/);
  });

  it("returns data without a connected wallet (no wallet gate)", async () => {
    // No wallet mock needed — hook should work regardless.
    mockTotalSupply.mockResolvedValue(50_000_000n);

    const { result } = renderHook(() => useStellarPlusdTotalSupply(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(50_000_000n);
    });
  });
});

// ── Tests: useStellarUsdcReserveBalance ───────────────────────────────────────

describe("useStellarUsdcReserveBalance", () => {
  beforeEach(() => {
    localStorage.clear();
    mockBalance.mockClear();
    mockPlusdId = PLUSD_ID;
    mockUsdcId = USDC_ID;
    mockReserveAccountId = RESERVE_ID;
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns data from mock key without making any RPC call", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.usdc.reserveBalance",
      "100000000000",
    );

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBe(100_000_000_000n);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockBalance).not.toHaveBeenCalled();
  });

  it("returns undefined when usdcId is empty (no RPC)", () => {
    mockUsdcId = "";

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockBalance).not.toHaveBeenCalled();
  });

  it("returns undefined when reserveAccountId is empty (no RPC)", () => {
    mockReserveAccountId = "";

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockBalance).not.toHaveBeenCalled();
  });

  it("returns data from the RPC client in ready state", async () => {
    mockBalance.mockResolvedValue(75_000_000_000n);

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(75_000_000_000n);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces error when RPC fails", async () => {
    mockBalance.mockRejectedValue(new Error("balance call failed"));

    const { result } = renderHook(() => useStellarUsdcReserveBalance(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/balance call failed/);
  });
});

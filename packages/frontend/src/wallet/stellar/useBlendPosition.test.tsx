/**
 * Unit tests for `useBlendPosition` and `formatBlendPosition`.
 *
 * All Soroban RPC calls are mocked — no real network.
 *
 * Scenarios:
 *   1. formatBlendPosition — 7-decimal formatting.
 *   2. With position → `position` bigint + `formattedPosition` string.
 *   3. No position / unfunded → `position === 0n`, `formattedPosition` shows "0".
 *   4. Mock key → returns mock value; loadBlendCollateral never called.
 *   5. Disconnected → position undefined; query disabled.
 *   6. Error → surfaces via `error`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBlendPosition, formatBlendPosition } from "./useBlendPosition";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const { mockLoadBlendCollateral } = vi.hoisted(() => ({
  mockLoadBlendCollateral: vi.fn(),
}));

// ── Mock ./blendPool ──────────────────────────────────────────────────────────

vi.mock("./blendPool", () => ({
  loadBlendCollateral: mockLoadBlendCollateral,
  RequestType: { SupplyCollateral: 2, WithdrawCollateral: 3 },
}));

// ── Mock ./useStellarWallet ───────────────────────────────────────────────────

const mockStellarWallet = vi.hoisted(() => ({
  address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" as
    | string
    | undefined,
  isConnected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock("./useStellarWallet", () => ({
  useStellarWallet: () => ({ ...mockStellarWallet }),
}));

// ── Mock ./chain ──────────────────────────────────────────────────────────────

vi.mock("./chain", () => ({
  blendXlmId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  blendPoolId: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
  blendNetwork: {
    rpc: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  },
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const POSITION_MOCK_KEY = "pipeline.mock.wallet.stellar.blend.position";
const STELLAR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { wrapper, queryClient };
}

// ── Tests: formatBlendPosition ────────────────────────────────────────────────

describe("formatBlendPosition", () => {
  it("formats 10000000n as '1.0000000' (1 XLM)", () => {
    expect(formatBlendPosition(10_000_000n)).toBe("1.0000000");
  });

  it("formats 0n as '0.0000000'", () => {
    expect(formatBlendPosition(0n)).toBe("0.0000000");
  });

  it("formats 500000n as '0.0500000' (0.05 XLM)", () => {
    expect(formatBlendPosition(500_000n)).toBe("0.0500000");
  });

  it("formats 123456789n as '12.3456789'", () => {
    expect(formatBlendPosition(123_456_789n)).toBe("12.3456789");
  });
});

// ── Tests: with position ──────────────────────────────────────────────────────

describe("useBlendPosition — with position", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadBlendCollateral.mockClear();
    mockLoadBlendCollateral.mockResolvedValue(50_000_000n);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns position bigint and formattedPosition string", async () => {
    const { result } = renderHook(() => useBlendPosition(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.position).toBeDefined();
    });

    expect(result.current.position).toBe(50_000_000n);
    expect(result.current.formattedPosition).toBe("5.0000000");
    expect(result.current.error).toBeNull();
    expect(mockLoadBlendCollateral).toHaveBeenCalledOnce();
  });
});

// ── Tests: no position / unfunded ─────────────────────────────────────────────

describe("useBlendPosition — no position / unfunded", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadBlendCollateral.mockClear();
    mockLoadBlendCollateral.mockResolvedValue(0n);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns position 0n and formattedPosition '0.0000000' with no error", async () => {
    const { result } = renderHook(() => useBlendPosition(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.position).toBeDefined();
    });

    expect(result.current.position).toBe(0n);
    expect(result.current.formattedPosition).toBe("0.0000000");
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: mock key ───────────────────────────────────────────────────────────

describe("useBlendPosition — mock key", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadBlendCollateral.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns mock position; loadBlendCollateral is never called", () => {
    localStorage.setItem(POSITION_MOCK_KEY, "10000000");

    const { result } = renderHook(() => useBlendPosition(), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.position).toBe(10_000_000n);
    expect(result.current.formattedPosition).toBe("1.0000000");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    // Lock-in guard: no RPC in mock mode
    expect(mockLoadBlendCollateral).not.toHaveBeenCalled();
  });
});

// ── Tests: disconnected ───────────────────────────────────────────────────────

describe("useBlendPosition — disconnected", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = undefined;
    mockStellarWallet.isConnected = false;
    mockLoadBlendCollateral.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
  });

  it("returns undefined position; loadBlendCollateral is never called", () => {
    const { result } = renderHook(() => useBlendPosition(), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.position).toBeUndefined();
    expect(result.current.formattedPosition).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockLoadBlendCollateral).not.toHaveBeenCalled();
  });
});

// ── Tests: error ──────────────────────────────────────────────────────────────

describe("useBlendPosition — error", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadBlendCollateral.mockClear();
    mockLoadBlendCollateral.mockRejectedValue(new Error("rpc timeout"));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("surfaces the error via error field", async () => {
    const { result } = renderHook(() => useBlendPosition(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe("rpc timeout");
    expect(result.current.position).toBeUndefined();
  });
});

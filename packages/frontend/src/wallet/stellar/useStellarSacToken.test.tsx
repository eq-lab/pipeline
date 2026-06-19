/**
 * Unit tests for `useStellarSacToken`, `sacRawToDisplay`, `sacDisplayToRaw`.
 *
 * All Horizon calls are intercepted via vitest mocks — no real network access.
 *
 * Scenarios:
 *   1. sacRawToDisplay / sacDisplayToRaw — scaling math at 7 decimals.
 *   2. Balance present (7-decimal) — correct raw-to-display scaling; isAuthorized true.
 *   3. Issuer mismatch → balance "0", hasTrustline false, isAuthorized false.
 *   4. No trustline → "0", hasTrustline false, isAuthorized false, no error.
 *   5. Unfunded account (404) → "0", hasTrustline false, isAuthorized false, no error.
 *   6. Hard error → surfaced on `error`.
 *   7. Disconnected → balance undefined, isAuthorized false.
 *   8. Mock key (bigint string) → returns scaled mock balance; no Horizon call; isAuthorized true when > 0.
 *   9. SAC_DECIMALS constant = 7.
 *  10. decimals field on result = SAC_DECIMALS.
 *  11. Trustline present + is_authorized false → hasTrustline true, isAuthorized false.
 *  12. Trustline present + is_authorized true → hasTrustline true, isAuthorized true.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useStellarSacToken,
  sacRawToDisplay,
  sacDisplayToRaw,
  SAC_DECIMALS,
} from "./useStellarSacToken";

// ── Hoisted spy ───────────────────────────────────────────────────────────────

const mockLoadAccount = vi.hoisted(() => vi.fn());

// ── Mock @stellar/stellar-sdk ─────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    loadAccount(address: string) {
      return mockLoadAccount(address);
    }
  }
  return { Horizon: { Server: MockServer } };
});

// ── Mock ./useStellarWallet ───────────────────────────────────────────────────

const mockStellarWallet = vi.hoisted(() => ({
  address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV" as
    | string
    | undefined,
  isConnected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("./useStellarWallet", () => ({
  useStellarWallet: () => ({ ...mockStellarWallet }),
}));

// ── Mock ./chain ──────────────────────────────────────────────────────────────

vi.mock("./chain", () => ({
  horizonUrl: "https://horizon-testnet.stellar.org",
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const PROTOCOL_ISSUER =
  "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM";
const FAKE_ISSUER = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGYWDOUALPFD9TLVMQSRJV";
const USDC_CONTRACT =
  "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7";
const STELLAR_ADDR = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";

const SAC_PARAMS = {
  assetCode: "USDC",
  assetIssuer: PROTOCOL_ISSUER,
  contractId: USDC_CONTRACT,
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

function makeBalances(
  balance: string,
  issuer = PROTOCOL_ISSUER,
  isAuthorized = true,
): object[] {
  return [
    { asset_type: "native", balance: "1.0000000" },
    {
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: issuer,
      balance,
      is_authorized: isAuthorized,
    },
  ];
}

// ── Tests: scaling helpers ────────────────────────────────────────────────────

describe("SAC_DECIMALS", () => {
  it("is 7", () => {
    expect(SAC_DECIMALS).toBe(7);
  });
});

describe("sacRawToDisplay", () => {
  it("converts 1 unit (10_000_000n) to '1.0000000'", () => {
    expect(sacRawToDisplay(10_000_000n)).toBe("1.0000000");
  });

  it("converts 0n to '0.0000000'", () => {
    expect(sacRawToDisplay(0n)).toBe("0.0000000");
  });

  it("converts 1_500_000n to '0.1500000'", () => {
    expect(sacRawToDisplay(1_500_000n)).toBe("0.1500000");
  });

  it("converts 12_345_678_900n to '1234.5678900'", () => {
    expect(sacRawToDisplay(12_345_678_900n)).toBe("1234.5678900");
  });
});

describe("sacDisplayToRaw", () => {
  it("converts '1.0' to 10_000_000n", () => {
    expect(sacDisplayToRaw("1.0")).toBe(10_000_000n);
  });

  it("converts '0.15' to 1_500_000n", () => {
    expect(sacDisplayToRaw("0.15")).toBe(1_500_000n);
  });

  it("handles no fractional part", () => {
    expect(sacDisplayToRaw("2")).toBe(20_000_000n);
  });

  it("truncates beyond 7 decimals", () => {
    // '1.12345678' → truncated to '1.1234567' → 11_234_567n
    expect(sacDisplayToRaw("1.12345678")).toBe(11_234_567n);
  });
});

// ── Tests: balance present ────────────────────────────────────────────────────

describe("useStellarSacToken — balance present", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockLoadAccount.mockResolvedValue({
      balances: makeBalances("1234.5678900"),
    });
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("returns balance string and hasTrustline true", async () => {
    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });
    expect(result.current.balance).toBe("1234.5678900");
    expect(result.current.hasTrustline).toBe(true);
    expect(result.current.isAuthorized).toBe(true);
    expect(result.current.decimals).toBe(7);
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: issuer mismatch ────────────────────────────────────────────────────

describe("useStellarSacToken — issuer mismatch", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockLoadAccount.mockResolvedValue({
      balances: makeBalances("100.0000000", FAKE_ISSUER),
    });
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("ignores balance from wrong issuer → '0', hasTrustline false, isAuthorized false", async () => {
    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });
    expect(result.current.balance).toBe("0");
    expect(result.current.hasTrustline).toBe(false);
    expect(result.current.isAuthorized).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: no trustline ───────────────────────────────────────────────────────

describe("useStellarSacToken — no trustline", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "10.0000000" }],
    });
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("returns '0', hasTrustline false, isAuthorized false, no error", async () => {
    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });
    expect(result.current.balance).toBe("0");
    expect(result.current.hasTrustline).toBe(false);
    expect(result.current.isAuthorized).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: unfunded account (404) ─────────────────────────────────────────────

describe("useStellarSacToken — unfunded (404)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    const err = Object.assign(new Error("Not Found"), {
      response: { status: 404 },
    });
    mockLoadAccount.mockRejectedValue(err);
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("treats 404 as zero balance, not an error; isAuthorized false", async () => {
    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });
    expect(result.current.balance).toBe("0");
    expect(result.current.hasTrustline).toBe(false);
    expect(result.current.isAuthorized).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: hard error ─────────────────────────────────────────────────────────

describe("useStellarSacToken — hard error", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockLoadAccount.mockRejectedValue(new Error("network timeout"));
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("surfaces a non-404 error", async () => {
    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.balance).toBeUndefined();
    expect(result.current.hasTrustline).toBe(false);
    expect(result.current.error?.message).toBe("network timeout");
  });
});

// ── Tests: disconnected ───────────────────────────────────────────────────────

describe("useStellarSacToken — disconnected", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = undefined;
    mockStellarWallet.isConnected = false;
    mockLoadAccount.mockClear();
  });
  afterEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
  });

  it("returns undefined balance; loadAccount is never called; isAuthorized false", () => {
    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.balance).toBeUndefined();
    expect(result.current.hasTrustline).toBe(false);
    expect(result.current.isAuthorized).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });
});

// ── Tests: mock key ───────────────────────────────────────────────────────────

describe("useStellarSacToken — mock key", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("returns scaled mock balance; loadAccount never called; isAuthorized true", () => {
    // 10_000_000n = 1 USDC at 7 decimals
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.balance.sac.usdc",
      "10000000",
    );

    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });

    // sacRawToDisplay(10_000_000n) = "1.0000000"
    expect(result.current.balance).toBe("1.0000000");
    expect(result.current.hasTrustline).toBe(true);
    expect(result.current.isAuthorized).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });

  it("hasTrustline and isAuthorized are false for zero mock balance", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.balance.sac.usdc", "0");

    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.balance).toBe("0.0000000");
    expect(result.current.hasTrustline).toBe(false);
    expect(result.current.isAuthorized).toBe(false);
  });
});

// ── Tests: isAuthorized flag from Horizon ─────────────────────────────────────

describe("useStellarSacToken — trustline present, is_authorized: false", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    // Trustline exists but issuer has not yet authorized it.
    mockLoadAccount.mockResolvedValue({
      balances: makeBalances("0.0000000", PROTOCOL_ISSUER, false),
    });
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("hasTrustline is true but isAuthorized is false when is_authorized=false", async () => {
    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });
    // Wait for the query to resolve: balance becomes defined once Horizon responds.
    await waitFor(() => {
      expect(result.current.balance).toBe("0.0000000");
    });
    expect(result.current.hasTrustline).toBe(true);
    expect(result.current.isAuthorized).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useStellarSacToken — trustline present, is_authorized: true", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockLoadAccount.mockResolvedValue({
      balances: makeBalances("500.0000000", PROTOCOL_ISSUER, true),
    });
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("hasTrustline true and isAuthorized true when is_authorized=true", async () => {
    const { result } = renderHook(() => useStellarSacToken(SAC_PARAMS), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => {
      expect(result.current.hasTrustline).toBe(true);
    });
    expect(result.current.isAuthorized).toBe(true);
    expect(result.current.balance).toBe("500.0000000");
    expect(result.current.error).toBeNull();
  });
});

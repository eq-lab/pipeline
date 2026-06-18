/**
 * Unit tests for `useStellarToken` and `formatUsdcDisplay`.
 *
 * All Horizon calls are intercepted via vitest mocks — no real network access.
 * Scenarios:
 *   1. formatUsdcDisplay — USD currency formatting.
 *   2. With USDC balance — connected; loadAccount resolves matching entry.
 *   3. Issuer mismatch is ignored — USDC from a different issuer → "0".
 *   4. No trustline — only native XLM entry → balance "0", no error.
 *   5. Unfunded account (404) — loadAccount rejects with NotFoundError → "0".
 *   6. Hard error — loadAccount rejects with generic error → surfaces on `error`.
 *   7. Disconnected — query disabled; balance undefined; loadAccount never called.
 *   8. Issuer not resolved — query idle until the on-chain USDC issuer loads.
 *   9. Mock key — hook returns mock value; loadAccount never called.
 *  10. refetchBalance is a function.
 *
 * The protocol USDC issuer is derived on-chain via
 * `useStellarDepositManagerAddresses` (mocked here), not from env.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStellarToken, formatUsdcDisplay } from "./useStellarToken";

// ── Hoisted spy ───────────────────────────────────────────────────────────────

const mockLoadAccount = vi.hoisted(() => vi.fn());

// ── Mock @stellar/stellar-sdk ─────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    loadAccount(address: string) {
      return mockLoadAccount(address);
    }
  }
  return {
    Horizon: {
      Server: MockServer,
    },
  };
});

// ── Mock ./useStellarWallet ───────────────────────────────────────────────────

const mockStellarWallet = vi.hoisted(() => ({
  address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" as
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
// Use vi.hoisted so the constants are available when vi.mock factory runs.

const { USDC_ISSUER, HORIZON_URL } = vi.hoisted(() => ({
  USDC_ISSUER: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  HORIZON_URL: "https://horizon-testnet.stellar.org",
}));

vi.mock("./chain", () => ({
  horizonUrl: HORIZON_URL,
}));

// ── Mock ./useStellarDepositManagerAddresses ──────────────────────────────────
// The protocol USDC issuer is now derived on-chain. `mockAddresses.value` is
// the resolver's `addresses` — set to `undefined` to simulate the not-yet-
// resolved state (query stays idle).

const mockAddresses = vi.hoisted(() => ({
  value: {
    usdc: "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7",
    plusd: "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN",
    usdcAsset: {
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    },
    plusdAsset: {
      code: "PLUSD",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    },
  } as object | undefined,
}));

vi.mock("./useStellarDepositManagerAddresses", () => ({
  useStellarDepositManagerAddresses: () => ({
    addresses: mockAddresses.value,
    isLoading: false,
    error: null,
  }),
}));

// ── Mock ./mock ───────────────────────────────────────────────────────────────
// We let the real mock module run so that localStorage-based mock keys work.
// No mock needed — the module has no side effects.

// ── Mock ../evm/mock ──────────────────────────────────────────────────────────
// We want the real useMock / readMock behaviour (localStorage-based).
// No mock override needed.

// ── Helpers ───────────────────────────────────────────────────────────────────

const STELLAR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BALANCE_KEY = "pipeline.mock.wallet.stellar.balance.usdc";

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

function makeUsdcBalances(
  balance: string,
  issuer: string = USDC_ISSUER,
): object[] {
  return [
    { asset_type: "native", balance: "1.0000000" },
    {
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: issuer,
      balance,
    },
  ];
}

// ── Tests: formatUsdcDisplay ──────────────────────────────────────────────────

describe("formatUsdcDisplay", () => {
  it("formats a decimal string as a USD currency string", () => {
    expect(formatUsdcDisplay("1234.5678900")).toBe("$1,234.57");
  });

  it("formats zero as $0.00", () => {
    expect(formatUsdcDisplay("0")).toBe("$0.00");
  });

  it("formats a small amount", () => {
    expect(formatUsdcDisplay("1.5")).toBe("$1.50");
  });
});

// ── Tests: useStellarToken — with USDC balance ────────────────────────────────

describe("useStellarToken — with balance", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockLoadAccount.mockResolvedValue({
      balances: makeUsdcBalances("1234.5678900"),
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns balance and formattedBalance when USDC entry is found", async () => {
    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });

    expect(result.current.balance).toBe("1234.5678900");
    expect(result.current.formattedBalance).toBe("$1,234.57");
    expect(result.current.error).toBeNull();
    expect(mockLoadAccount).toHaveBeenCalledWith(STELLAR_ADDR);
  });
});

// ── Tests: issuer mismatch ────────────────────────────────────────────────────

describe("useStellarToken — issuer mismatch", () => {
  const FAKE_ISSUER = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGYWDOUALPFD9TLVMQSRJV";

  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockLoadAccount.mockResolvedValue({
      balances: makeUsdcBalances("100.0000000", FAKE_ISSUER),
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("ignores USDC from a different issuer → returns balance '0'", async () => {
    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });

    expect(result.current.balance).toBe("0");
    expect(result.current.formattedBalance).toBe("$0.00");
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: no trustline ───────────────────────────────────────────────────────

describe("useStellarToken — no trustline", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    // Only native XLM balance
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "10.0000000" }],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns balance '0' and formattedBalance '$0.00' with no error", async () => {
    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });

    expect(result.current.balance).toBe("0");
    expect(result.current.formattedBalance).toBe("$0.00");
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: unfunded account (404) ─────────────────────────────────────────────

describe("useStellarToken — unfunded account (404)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    // Simulate a Horizon NotFoundError (status 404)
    const err = Object.assign(new Error("Not Found"), {
      response: { status: 404 },
    });
    mockLoadAccount.mockRejectedValue(err);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("treats 404 as zero balance, not an error", async () => {
    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });

    expect(result.current.balance).toBe("0");
    expect(result.current.formattedBalance).toBe("$0.00");
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: hard error ─────────────────────────────────────────────────────────

describe("useStellarToken — hard error", () => {
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

  it("surfaces a non-404 error on the error field", async () => {
    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.balance).toBeUndefined();
    expect(result.current.formattedBalance).toBeUndefined();
    expect(result.current.error?.message).toBe("network timeout");
  });
});

// ── Tests: disconnected ───────────────────────────────────────────────────────

describe("useStellarToken — disconnected", () => {
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

  it("returns undefined balance; loadAccount is never called", () => {
    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.balance).toBeUndefined();
    expect(result.current.formattedBalance).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });
});

// ── Tests: protocol issuer not yet resolved ───────────────────────────────────

describe("useStellarToken — issuer not resolved", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockAddresses.value = undefined; // resolver still loading
  });

  afterEach(() => {
    localStorage.clear();
    mockAddresses.value = {
      usdc: "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7",
      plusd: "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN",
      usdcAsset: { code: "USDC", issuer: USDC_ISSUER },
      plusdAsset: { code: "PLUSD", issuer: USDC_ISSUER },
    };
  });

  it("stays idle (no Horizon call) until the protocol USDC issuer resolves", () => {
    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.balance).toBeUndefined();
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });
});

// ── Tests: mock key ───────────────────────────────────────────────────────────

describe("useStellarToken — mock key", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns mock balance and formatted string; loadAccount is never called", () => {
    localStorage.setItem(BALANCE_KEY, "1.5");

    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.balance).toBe("1.5");
    expect(result.current.formattedBalance).toBe("$1.50");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    // Lock-in guard: no RPC in mock mode
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });
});

// ── Tests: refetchBalance ─────────────────────────────────────────────────────

describe("useStellarToken — refetchBalance", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStellarWallet.address = STELLAR_ADDR;
    mockStellarWallet.isConnected = true;
    mockLoadAccount.mockClear();
    mockLoadAccount.mockResolvedValue({
      balances: makeUsdcBalances("10.0000000"),
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("exposes refetchBalance as a function", async () => {
    const { result } = renderHook(() => useStellarToken(), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => {
      expect(result.current.balance).toBeDefined();
    });

    expect(typeof result.current.refetchBalance).toBe("function");
  });
});

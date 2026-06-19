/**
 * Tests for useStellarStakedPlusd hooks.
 *
 * All scenarios:
 *   useStellarStake:
 *     1. mock-key happy path (stake)
 *     2. unconfigured guard
 *     3. disconnected guard
 *     4. declined signature → error
 *     5. simulation failure (paused / auth failure) → error
 *     6. reset clears state
 *
 *   useStellarUnstake:
 *     7. mock-key happy path (unstake)
 *     8. unconfigured guard
 *     9. declined signature → error
 *
 *   useStellarStakeConvertToShares:
 *    10. mock rate path — uses SAC 1e7 scale (NOT 1e18 EVM scale) [scale guard]
 *    11. returns undefined when input is undefined
 *
 *   useStellarUnstakeConvertToAssets:
 *    12. mock rate path — uses SAC 1e7 scale (NOT 1e18 EVM scale) [scale guard]
 *    13. returns undefined when input is undefined
 *
 *   useStellarStakedPlusdBalance:
 *    14. mock balance path
 *    15. returns undefined when disconnected
 *
 *   useStellarChangeTrustStakedPlusd:
 *    16. mock-key happy path (sPLUSD trustline)
 *    17. declined signature → error
 *    18. reset clears state
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStellarStake,
  useStellarUnstake,
  useStellarStakeConvertToShares,
  useStellarUnstakeConvertToAssets,
  useStellarStakedPlusdBalance,
  useStellarChangeTrustStakedPlusd,
} from "./useStellarStakedPlusd";
import { useStellarWallet } from "./useStellarWallet";
import * as mockModule from "./mock";

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

vi.mock("./chain", () => ({
  stakedPlusdId: "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
}));

// ── Mock useStellarWallet ─────────────────────────────────────────────────────

const mockSignTransaction = vi.fn();
vi.mock("./useStellarWallet", () => ({
  useStellarWallet: vi.fn(() => ({
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    isConnected: true,
    signTransaction: mockSignTransaction,
  })),
}));

// ── Mock useStellarSacToken ───────────────────────────────────────────────────

vi.mock("./useStellarSacToken", () => ({
  useStellarSacToken: vi.fn(() => ({
    balance: "0.0000000",
    hasTrustline: false,
    isAuthorized: false,
    decimals: 7,
    refetchBalance: vi.fn(),
    isLoading: false,
    error: null,
  })),
  SAC_DECIMALS: 7,
}));

// ── Mock StakedPlusdClient ────────────────────────────────────────────────────

const mockBuildDeposit = vi.fn();
const mockBuildRedeem = vi.fn();
const mockQueryAsset = vi.fn();
const mockBalance = vi.fn();
const mockConvertToShares = vi.fn();
const mockConvertToAssets = vi.fn();
const mockName = vi.fn();

vi.mock("./contracts/stakedPlusd", () => ({
  StakedPlusdClient: vi.fn().mockImplementation(function (this: object) {
    Object.assign(this, {
      buildDeposit: mockBuildDeposit,
      buildRedeem: mockBuildRedeem,
      queryAsset: mockQueryAsset,
      balance: mockBalance,
      convertToShares: mockConvertToShares,
      convertToAssets: mockConvertToAssets,
      name: mockName,
    });
  }),
  createStakedPlusdClient: vi.fn(() => ({
    buildDeposit: mockBuildDeposit,
    buildRedeem: mockBuildRedeem,
    queryAsset: mockQueryAsset,
    balance: mockBalance,
    convertToShares: mockConvertToShares,
    convertToAssets: mockConvertToAssets,
    name: mockName,
  })),
}));

// ── Mock @stellar/stellar-sdk ─────────────────────────────────────────────────

const mockPollTransaction = vi.fn();
const mockSendTransaction = vi.fn();
const mockGetAccount = vi.fn();
const mockLoadAccount = vi.fn();
const mockSubmitTransaction = vi.fn();

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk")>(
    "@stellar/stellar-sdk",
  );

  class MockTransactionBuilder {
    static fromXDR = vi.fn(() => ({
      toXDR: () => "signed-xdr",
      hash: "txhash",
    }));
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { toXDR: () => "unsigned-xdr", hash: "txhash" };
    }
  }

  class MockRpcServer {
    getAccount = mockGetAccount;
    sendTransaction = mockSendTransaction;
    pollTransaction = mockPollTransaction;
  }

  class MockHorizonServer {
    loadAccount = mockLoadAccount;
    submitTransaction = mockSubmitTransaction;
  }

  return {
    ...actual,
    rpc: {
      ...((actual as Record<string, unknown>)["rpc"] as object),
      Server: MockRpcServer,
      Api: {
        isSimulationError: vi.fn(() => false),
        GetTransactionStatus: { SUCCESS: "SUCCESS", FAILED: "FAILED" },
      },
    },
    Horizon: {
      Server: MockHorizonServer,
    },
    TransactionBuilder: MockTransactionBuilder,
    Asset: vi.fn().mockImplementation(function (this: object) {
      return this;
    }),
    Operation: {
      changeTrust: vi.fn(() => ({})),
    },
    scValToNative: vi.fn((val: unknown) => val),
  };
});

// ── localStorage mock ─────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, "localStorage", { value: localStorageMock });

// ── Test constants ────────────────────────────────────────────────────────────

const TEST_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// Reset cross-test mock leakage. `vi.clearAllMocks()` (used in the per-describe
// beforeEach hooks) only clears call history — it undoes neither `vi.spyOn`
// spies nor `mockReturnValue` implementations. Two such leaks would otherwise
// propagate between tests in this file:
//   1. The "unconfigured guard" tests install a getter spy forcing
//      `stakedPlusdId` to "" (→ spurious "StakedPLUSD not configured").
//   2. The disconnected-balance test sets `useStellarWallet` to a disconnected
//      value via `mockReturnValue` (→ spurious "Stellar wallet not connected").
// Restore spies after each test, and re-establish the connected wallet default
// before each, so every test starts from the factory baseline.
afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(useStellarWallet).mockImplementation(() => ({
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    isConnected: true,
    signTransaction: mockSignTransaction,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
});

// ── Tests: useStellarStake ────────────────────────────────────────────────────

describe("useStellarStake", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorageMock.clear();

    // The "unconfigured guard" test spies `stakedPlusdId` as a getter and
    // mocks it to "". That getter spy is not restored by vi.clearAllMocks(),
    // so it leaks into every later test in this (and the following) describe.
    // Re-spy it to the valid id before each test; the unconfigured-guard test
    // overrides it back to "" locally.
    const chainModule = await import("./chain");
    vi.spyOn(chainModule, "stakedPlusdId", "get").mockReturnValue(
      "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
    );

    mockGetAccount.mockResolvedValue({ id: TEST_ADDRESS, sequence: "1" });
    mockBuildDeposit.mockResolvedValue("assembled-xdr");
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "stake-hash",
    });
    mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("mock-key happy path for stake", async () => {
    vi.spyOn(mockModule, "readMockStellarStake").mockReturnValue({
      hash: "stake-mock-hash",
      shares: "9600000",
    });

    const { result } = renderHook(() => useStellarStake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.hash).toBe("stake-mock-hash");
    expect(result.current.data?.shares).toBe("9600000");
  });

  it("unconfigured guard returns error", async () => {
    const chainModule = await import("./chain");
    vi.spyOn(chainModule, "stakedPlusdId", "get").mockReturnValue("");
    vi.spyOn(mockModule, "readMockStellarStake").mockReturnValue(undefined);

    const { result } = renderHook(() => useStellarStake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    expect(result.current.error?.message).toMatch(/StakedPLUSD not configured/);
    expect(result.current.isPending).toBe(false);
  });

  it("disconnected guard returns error", async () => {
    const walletModule = await import("./useStellarWallet");
    vi.mocked(walletModule.useStellarWallet).mockReturnValueOnce({
      address: undefined,
      isConnected: false,
      signTransaction: mockSignTransaction,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    vi.spyOn(mockModule, "readMockStellarStake").mockReturnValue(undefined);

    const { result } = renderHook(() => useStellarStake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    expect(result.current.error?.message).toMatch(
      /Stellar wallet not connected/,
    );
  });

  it("declined signature sets error", async () => {
    mockSignTransaction.mockRejectedValue(new Error("User cancelled"));
    vi.spyOn(mockModule, "readMockStellarStake").mockReturnValue(undefined);

    const { result } = renderHook(() => useStellarStake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/User cancelled/);
  });

  it("simulation failure (paused vault) propagates as error", async () => {
    mockBuildDeposit.mockRejectedValue(
      new Error("StakedPlusd.deposit simulation error: Error(Contract, #101)"),
    );
    vi.spyOn(mockModule, "readMockStellarStake").mockReturnValue(undefined);

    const { result } = renderHook(() => useStellarStake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/simulation error/);
  });

  it("reset clears state", async () => {
    vi.spyOn(mockModule, "readMockStellarStake").mockReturnValue({
      hash: "h",
    });

    const { result } = renderHook(() => useStellarStake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isSuccess).toBe(false);
  });
});

// ── Tests: useStellarUnstake ──────────────────────────────────────────────────

describe("useStellarUnstake", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorageMock.clear();

    // See useStellarStake beforeEach: re-spy `stakedPlusdId` to the valid id so
    // the leaked "" from an earlier unconfigured-guard test does not bleed in.
    const chainModule = await import("./chain");
    vi.spyOn(chainModule, "stakedPlusdId", "get").mockReturnValue(
      "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
    );

    mockGetAccount.mockResolvedValue({ id: TEST_ADDRESS, sequence: "1" });
    mockBuildRedeem.mockResolvedValue("assembled-xdr");
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "unstake-hash",
    });
    mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("mock-key happy path for unstake", async () => {
    vi.spyOn(mockModule, "readMockStellarUnstake").mockReturnValue({
      hash: "unstake-mock-hash",
      assets: "10400000",
    });

    const { result } = renderHook(() => useStellarUnstake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.hash).toBe("unstake-mock-hash");
    expect(result.current.data?.assets).toBe("10400000");
  });

  it("unconfigured guard returns error", async () => {
    const chainModule = await import("./chain");
    vi.spyOn(chainModule, "stakedPlusdId", "get").mockReturnValue("");
    vi.spyOn(mockModule, "readMockStellarUnstake").mockReturnValue(undefined);

    const { result } = renderHook(() => useStellarUnstake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    expect(result.current.error?.message).toMatch(/StakedPLUSD not configured/);
  });

  it("declined signature sets error", async () => {
    mockSignTransaction.mockRejectedValue(new Error("Declined by user"));
    vi.spyOn(mockModule, "readMockStellarUnstake").mockReturnValue(undefined);

    const { result } = renderHook(() => useStellarUnstake(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/Declined by user/);
  });
});

// ── Tests: conversion scale guard (SAC 1e7, NOT EVM 1e18) ────────────────────

describe("useStellarStakeConvertToShares — SAC scale guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    // Set mock rate at SAC 1e7 scale: 0.96 → rate = 9_600_000n
    localStorageMock.setItem(
      "pipeline.mock.wallet.stellar.stakedPlusd.convertToShares",
      "9600000",
    );
  });

  it("applies SAC 1e7 scale (not EVM 1e18)", () => {
    const { result } = renderHook(
      () => useStellarStakeConvertToShares(10_000_000n),
      { wrapper: makeWrapper() },
    );

    // 10_000_000n * 9_600_000n / 10_000_000n = 9_600_000n (0.96 sPLUSD per PLUSD)
    expect(result.current.data).toBe(9_600_000n);
    expect(result.current.isLoading).toBe(false);
  });

  it("result is NOT divided by 1e18 (EVM scale would give ~0)", () => {
    const { result } = renderHook(
      () => useStellarStakeConvertToShares(10_000_000n),
      { wrapper: makeWrapper() },
    );

    // If it incorrectly used 1e18, result would be ~0n (or tiny)
    expect(result.current.data).toBeGreaterThan(0n);
    // Specifically: should be in the same 7-decimal magnitude as input
    expect(result.current.data).toBe(9_600_000n);
  });

  it("returns undefined when assets is undefined", () => {
    const { result } = renderHook(
      () => useStellarStakeConvertToShares(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
  });
});

describe("useStellarUnstakeConvertToAssets — SAC scale guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    // Set mock rate at SAC 1e7 scale: 1.04 → rate = 10_400_000n
    localStorageMock.setItem(
      "pipeline.mock.wallet.stellar.stakedPlusd.convertToAssets",
      "10400000",
    );
  });

  it("applies SAC 1e7 scale (not EVM 1e18)", () => {
    const { result } = renderHook(
      () => useStellarUnstakeConvertToAssets(10_000_000n),
      { wrapper: makeWrapper() },
    );

    // 10_000_000n * 10_400_000n / 10_000_000n = 10_400_000n (1.04 PLUSD per sPLUSD)
    expect(result.current.data).toBe(10_400_000n);
    expect(result.current.isLoading).toBe(false);
  });

  it("returns undefined when shares is undefined", () => {
    const { result } = renderHook(
      () => useStellarUnstakeConvertToAssets(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
  });
});

// ── Tests: useStellarStakedPlusdBalance ───────────────────────────────────────

describe("useStellarStakedPlusdBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it("returns mock balance as bigint", () => {
    localStorageMock.setItem(
      "pipeline.mock.wallet.stellar.stakedPlusd.shareBalance",
      "10000000",
    );

    const { result } = renderHook(() => useStellarStakedPlusdBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.balance).toBe(10_000_000n);
    expect(result.current.isLoading).toBe(false);
  });

  it("returns undefined balance when disconnected", async () => {
    const walletModule = await import("./useStellarWallet");
    vi.mocked(walletModule.useStellarWallet).mockReturnValue({
      address: undefined,
      isConnected: false,
      signTransaction: mockSignTransaction,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    const { result } = renderHook(() => useStellarStakedPlusdBalance(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.balance).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});

// ── Tests: useStellarChangeTrustStakedPlusd ───────────────────────────────────

describe("useStellarChangeTrustStakedPlusd", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorageMock.clear();

    // Earlier tests spy on `stakedPlusdId` as a getter and mock it to "".
    // vi.restoreAllMocks() does NOT restore it because the original property
    // on a vi.mock() factory module is a plain value, not a getter. We must
    // explicitly re-spy it to the correct value so that `enabled: !!stakedPlusdId`
    // stays true and the shareAssetQuery actually runs.
    const chainModule = await import("./chain");
    vi.spyOn(chainModule, "stakedPlusdId", "get").mockReturnValue(
      "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
    );

    // Reset useStellarWallet to the default connected state. The
    // "returns undefined when disconnected" test in useStellarStakedPlusdBalance
    // uses mockReturnValue (permanent) to set isConnected: false, which persists
    // into this describe block. Without this reset, `if (!isConnected)` in
    // trustlineStatus returns "loading" immediately.
    const walletModule = await import("./useStellarWallet");
    vi.mocked(walletModule.useStellarWallet).mockReturnValue({
      address: TEST_ADDRESS,
      isConnected: true,
      signTransaction: mockSignTransaction,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    // Explicitly reset mockName: mockReset() clears the implementation set by
    // the "loading" test's mockReturnValue(new Promise(() => {})).
    mockName.mockReset();
    mockName.mockResolvedValue(
      "sPLUSD:GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
    );
    mockLoadAccount.mockResolvedValue({
      id: TEST_ADDRESS,
      sequence: "1",
      accountId: () => TEST_ADDRESS,
      incrementSequenceNumber: () => {},
    });
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSubmitTransaction.mockResolvedValue({ hash: "trust-hash" });
  });

  it("mock-key happy path for sPLUSD trustline", async () => {
    vi.spyOn(
      mockModule,
      "readMockStellarChangeTrustStakedPlusd",
    ).mockReturnValue({ hash: "trust-mock-hash" });

    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    act(() => {
      result.current.submit();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.hash).toBe("trust-mock-hash");
  });

  // Regression test for #685: while the share asset is still loading
  // (name() call not yet resolved), the step must NOT be "satisfied" —
  // trustlineStatus must be "loading" and needsTrustline must be false
  // (not "needed" — not yet known).
  it("trustlineStatus is loading while share asset has not resolved", () => {
    // mockName is set up in beforeEach to resolve, but here we make it
    // hang so the query stays in isLoading state. We test the synchronous
    // initial state before the promise settles.
    mockName.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    // Immediately after mount the query is still loading.
    expect(result.current.trustlineStatus).toBe("loading");
    // needsTrustline must be false — "not yet known" is not "needed"
    expect(result.current.needsTrustline).toBe(false);
  });

  // Share asset resolved, no trustline → "needed"
  it("trustlineStatus is 'needed' when share asset resolved and trustline missing", async () => {
    // mockName resolves in beforeEach to a valid "CODE:ISSUER" string.
    // useStellarSacToken is mocked to hasTrustline: false (the default mock).

    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(result.current.trustlineStatus).toBe("needed"),
    );
    expect(result.current.needsTrustline).toBe(true);
  });

  // Share asset resolved, trustline present → "satisfied"
  it("trustlineStatus is 'satisfied' when share asset resolved and trustline present", async () => {
    // Override useStellarSacToken to return hasTrustline: true for all calls
    // in this test. Use mockReturnValue (not Once) because the hook calls
    // useStellarSacToken on every render — once with assetCode:"" (before
    // name() resolves) and again with assetCode:"sPLUSD" (after). mockReturnValue
    // ensures hasTrustline:true for every call including the second render.
    // We restore the default after this test to avoid polluting later tests.
    const sacModule = await import("./useStellarSacToken");
    const defaultSacReturn = {
      balance: "0.0000000",
      hasTrustline: false,
      isAuthorized: false,
      decimals: 7,
      refetchBalance: vi.fn(),
      isLoading: false,
      error: null,
    };
    vi.mocked(sacModule.useStellarSacToken).mockReturnValue({
      ...defaultSacReturn,
      balance: "1.0000000",
      hasTrustline: true,
      isAuthorized: true,
    });

    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(result.current.trustlineStatus).toBe("satisfied"),
    );
    expect(result.current.needsTrustline).toBe(false);

    // Restore default so subsequent tests are not affected.
    vi.mocked(sacModule.useStellarSacToken).mockReturnValue(defaultSacReturn);
  });

  // Regression: name() returns non-"CODE:ISSUER" format → "error", staking blocked
  it("trustlineStatus is 'error' when name() returns unexpected format", async () => {
    // Override mockName to return a non-"CODE:ISSUER" string.
    mockName.mockResolvedValue("not-a-valid-asset-string");

    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(result.current.trustlineStatus).toBe("error"),
    );
    // needsTrustline must be false — we don't know enough to assert "needed"
    expect(result.current.needsTrustline).toBe(false);
  });

  // Regression: name() rejects → "error", staking blocked
  it("trustlineStatus is 'error' when name() rejects", async () => {
    mockName.mockRejectedValue(new Error("RPC connection refused"));

    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(result.current.trustlineStatus).toBe("error"),
    );
    expect(result.current.needsTrustline).toBe(false);
  });

  it("declined signature sets error", async () => {
    mockSignTransaction.mockRejectedValue(new Error("Declined"));
    vi.spyOn(
      mockModule,
      "readMockStellarChangeTrustStakedPlusd",
    ).mockReturnValue(undefined);

    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    // Wait for name() to resolve so shareAsset is loaded before submit()
    // (otherwise the "share asset not loaded" guard fires first).
    await waitFor(() =>
      expect(result.current.trustlineStatus).not.toBe("loading"),
    );

    act(() => {
      result.current.submit();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/Declined/);
  });

  it("reset clears state", async () => {
    vi.spyOn(
      mockModule,
      "readMockStellarChangeTrustStakedPlusd",
    ).mockReturnValue({ hash: "h" });

    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isSuccess).toBe(false);
  });
});

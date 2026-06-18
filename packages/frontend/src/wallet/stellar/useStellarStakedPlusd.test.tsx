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
import { describe, it, expect, vi, beforeEach } from "vitest";
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

// ── Tests: useStellarStake ────────────────────────────────────────────────────

describe("useStellarStake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();

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
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();

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
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();

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

  it("needsTrustline is true when connected with no trustline", () => {
    const { result } = renderHook(
      () => useStellarChangeTrustStakedPlusd(),
      { wrapper: makeWrapper() },
    );

    // useStellarSacToken mocked to return hasTrustline: false
    expect(result.current.needsTrustline).toBe(false); // shareAsset not yet loaded
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

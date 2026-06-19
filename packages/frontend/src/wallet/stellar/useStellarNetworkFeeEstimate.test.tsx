/**
 * Tests for useStellarNetworkFeeEstimate.
 *
 * Covers:
 *   - `formatFeeXlm` formats correctly.
 *   - Mock key fast path returns the formatted string (deposit + withdraw).
 *   - Disconnected wallet returns undefined.
 *   - Real query path (withdraw): success → defined feeXlm, no query rejection.
 *   - Real query path: failure → error is surfaced (non-null), no undefined-rejection.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStellarNetworkFeeEstimate,
  formatFeeXlm,
} from "./useStellarNetworkFeeEstimate";
import { installSameTabMockBridge } from "../evm/mock";

// ── Mock chain constants ──────────────────────────────────────────────────────

vi.mock("./chain", () => ({
  depositManagerId: "CARFA2QETOZVKHSG4BCEEXMJHTYR2Z75VR7WQNX4MWZ33RQMKRKATIVI",
  withdrawalQueueId: "CC3TWGFXP2XUZJXGLVTM2G4K2PF2YTC6BKDRPZIUPSVETNYAO57GU3Q7",
  stakedPlusdId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN8",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
}));

// ── Mock useStellarWallet ─────────────────────────────────────────────────────

const mockStellarWalletState = {
  address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" as
    | string
    | undefined,
  isConnected: true,
};

vi.mock("./useStellarWallet", () => ({
  useStellarWallet: vi.fn(() => mockStellarWalletState),
}));

// ── Hoisted mock functions (needed inside vi.mock factories) ──────────────────

const {
  mockBuildRequestWithdrawal,
  mockBuildRequestDeposit,
  mockGetAccount,
  mockFromXDR,
} = vi.hoisted(() => ({
  mockBuildRequestWithdrawal: vi.fn(),
  mockBuildRequestDeposit: vi.fn(),
  mockGetAccount: vi.fn(),
  mockFromXDR: vi.fn(),
}));

// ── Mock contract clients ─────────────────────────────────────────────────────

vi.mock("./contracts/withdrawalQueue", () => ({
  WithdrawalQueueClient: vi.fn(function (this: object) {
    Object.assign(this, { buildRequestWithdrawal: mockBuildRequestWithdrawal });
  }),
}));

vi.mock("./contracts/depositManager", () => ({
  DepositManagerClient: vi.fn(function (this: object) {
    Object.assign(this, { buildRequestDeposit: mockBuildRequestDeposit });
  }),
}));

vi.mock("./contracts/stakedPlusd", () => ({
  StakedPlusdClient: vi.fn(function (this: object) {
    Object.assign(this, {
      buildDeposit: vi.fn(),
      buildRedeem: vi.fn(),
    });
  }),
}));

// ── Mock @stellar/stellar-sdk ─────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk")>(
    "@stellar/stellar-sdk",
  );

  return {
    ...actual,
    rpc: {
      ...((actual as Record<string, unknown>)["rpc"] as object),
      Server: class MockRpcServer {
        getAccount(...args: unknown[]) {
          return mockGetAccount(...args);
        }
      },
    },
    TransactionBuilder: class MockTransactionBuilder {
      static fromXDR(...args: unknown[]) {
        return mockFromXDR(...args);
      }
    },
  };
});

// ── Wrapper ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// ── Tests: formatFeeXlm ───────────────────────────────────────────────────────

describe("formatFeeXlm", () => {
  it("formats stroops to XLM string with ~ prefix", () => {
    // 52000 stroops = 0.0052 XLM (trailing zero after 52 is stripped)
    expect(formatFeeXlm(52_000n)).toBe("~0.0052 XLM");
  });

  it("strips trailing zeros down to 2 places", () => {
    // 100000 stroops = 0.01 XLM
    expect(formatFeeXlm(100_000n)).toBe("~0.01 XLM");
  });

  it("handles zero", () => {
    expect(formatFeeXlm(0n)).toBe("~0.00 XLM");
  });

  it("handles whole XLM amounts", () => {
    // 10_000_000 stroops = 1 XLM
    expect(formatFeeXlm(10_000_000n)).toBe("~1.00 XLM");
  });

  it("pads to 2 decimal places", () => {
    // 1000000 stroops = 0.1 XLM
    expect(formatFeeXlm(1_000_000n)).toBe("~0.10 XLM");
  });
});

// ── Tests: mock-key fast path ─────────────────────────────────────────────────

describe("useStellarNetworkFeeEstimate — mock key path", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup = installSameTabMockBridge();
    localStorage.clear();
    // Reset to connected state
    mockStellarWalletState.address =
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    mockStellarWalletState.isConnected = true;
  });

  afterEach(() => {
    cleanup?.();
    localStorage.clear();
  });

  it("returns pre-formatted XLM string from mock key (deposit)", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.networkFeeEstimate.deposit",
      JSON.stringify("~0.0052 XLM"),
    );

    const { result } = renderHook(
      () => useStellarNetworkFeeEstimate("deposit"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.feeXlm).toBe("~0.0052 XLM");
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("prepends ~ and appends XLM to a raw numeric mock value (withdraw)", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.networkFeeEstimate.withdraw",
      JSON.stringify("0.0042"),
    );

    const { result } = renderHook(
      () => useStellarNetworkFeeEstimate("withdraw"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.feeXlm).toBe("~0.0042 XLM");
    });
  });

  it("returns undefined when wallet is disconnected", async () => {
    // Simulate disconnected state — no mock key set, wallet disconnected
    mockStellarWalletState.isConnected = false;
    mockStellarWalletState.address = undefined;

    const { result } = renderHook(
      () => useStellarNetworkFeeEstimate("deposit"),
      { wrapper: makeWrapper() },
    );

    // No mock key → real query path, but query is disabled (disconnected)
    expect(result.current.feeXlm).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: real query path ────────────────────────────────────────────────────

describe("useStellarNetworkFeeEstimate — real query path (no mock key)", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup = installSameTabMockBridge();
    localStorage.clear();
    // Ensure connected state
    mockStellarWalletState.address =
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    mockStellarWalletState.isConnected = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup?.();
    localStorage.clear();
  });

  it("withdraw: returns formatted feeXlm when simulation succeeds", async () => {
    // 52_000 stroops embedded in the assembled tx fee field
    const fakeXdr = "fake-assembled-xdr";
    mockGetAccount.mockResolvedValue({ id: "G...", sequence: "1" });
    mockBuildRequestWithdrawal.mockResolvedValue(fakeXdr);
    // TransactionBuilder.fromXDR returns a tx with fee = "52000" stroops
    mockFromXDR.mockReturnValue({ fee: "52000" });

    const { result } = renderHook(
      () => useStellarNetworkFeeEstimate("withdraw"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.feeXlm).toBe("~0.0052 XLM");
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("withdraw: surfaces query error (not undefined-rejection) when simulation fails", async () => {
    const simulationError = new Error("Soroban simulation failed");
    mockGetAccount.mockResolvedValue({ id: "G...", sequence: "1" });
    mockBuildRequestWithdrawal.mockRejectedValue(simulationError);

    // Spy to confirm no "Query data cannot be undefined" console error is emitted.
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { result } = renderHook(
      () => useStellarNetworkFeeEstimate("withdraw"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    // feeXlm must remain undefined (renders "—")
    expect(result.current.feeXlm).toBeUndefined();
    expect(result.current.isLoading).toBe(false);

    // No "Query data cannot be undefined" log — the error is a thrown rejection,
    // not an undefined resolution.
    const undefinedRejectionMessages = consoleErrorSpy.mock.calls
      .map((args) => String(args[0]))
      .filter((msg) => msg.includes("Query data cannot be undefined"));
    expect(undefinedRejectionMessages).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });
});

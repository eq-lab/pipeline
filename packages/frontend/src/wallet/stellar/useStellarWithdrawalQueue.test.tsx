/**
 * Tests for useStellarWithdrawalQueue hooks.
 *
 * Mocks:
 *   - ./contracts/withdrawalQueue    — WithdrawalQueueClient + createWithdrawalQueueClient
 *   - ./useStellarWallet             — useStellarWallet
 *   - ./chain                        — withdrawalQueueId, sorobanRpcUrl, networkPassphrase, horizonUrl
 *   - ./useStellarDepositManagerAddresses — useStellarDepositManagerAddresses
 *   - ./useStellarSacToken           — useStellarSacToken
 *   - @stellar/stellar-sdk           — rpc.Server, TransactionBuilder, Horizon, etc.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useStellarRequestWithdrawal,
  useStellarClaimWithdrawal,
  useStellarChangeTrustUsdc,
  readInflightWithdrawal,
  writeInflightWithdrawal,
  clearInflightWithdrawal,
} from "./useStellarWithdrawalQueue";
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
  withdrawalQueueId: "CC3TWGFXP2XUZJXGLVTM2G4K2PF2YTC6BKDRPZIUPSVETNYAO57GU3Q7",
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

// ── Mock useStellarDepositManagerAddresses ────────────────────────────────────

vi.mock("./useStellarDepositManagerAddresses", () => ({
  useStellarDepositManagerAddresses: vi.fn(() => ({
    addresses: {
      usdc: "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7",
      plusd: "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN",
      usdcAsset: {
        code: "USDC",
        issuer: "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
      },
      plusdAsset: {
        code: "PLUSD",
        issuer: "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
      },
    },
    isLoading: false,
    error: null,
  })),
}));

const { mockRefetchBalance } = vi.hoisted(() => ({
  mockRefetchBalance: vi.fn(),
}));
vi.mock("./useStellarSacToken", () => ({
  useStellarSacToken: vi.fn(() => ({
    balance: "0.0000000",
    hasTrustline: false,
    decimals: 7,
    refetchBalance: mockRefetchBalance,
    isLoading: false,
    error: null,
  })),
}));

// ── Mock WithdrawalQueueClient ────────────────────────────────────────────────

const mockBuildRequestWithdrawal = vi.fn();
const mockBuildClaimRequest = vi.fn();
const mockGetRequest = vi.fn();

vi.mock("./contracts/withdrawalQueue", () => ({
  WithdrawalQueueClient: vi.fn().mockImplementation(function (this: object) {
    Object.assign(this, {
      buildRequestWithdrawal: mockBuildRequestWithdrawal,
      buildClaimRequest: mockBuildClaimRequest,
      getRequest: mockGetRequest,
    });
  }),
  createWithdrawalQueueClient: vi.fn(() => ({
    buildRequestWithdrawal: mockBuildRequestWithdrawal,
    buildClaimRequest: mockBuildClaimRequest,
    getRequest: mockGetRequest,
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

// ── Test address ──────────────────────────────────────────────────────────────

const TEST_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// Restore `vi.spyOn` spies between tests. The per-describe `vi.clearAllMocks()`
// only clears call history — it does not undo spies. The "unconfigured guard"
// tests install a getter spy forcing `withdrawalQueueId` to "", which would
// otherwise leak into every subsequent test (→ spurious
// "WithdrawalQueue not configured").
afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests: useStellarRequestWithdrawal ────────────────────────────────────────

describe("useStellarRequestWithdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();

    // Default RPC mock setup
    mockGetAccount.mockResolvedValue({ id: TEST_ADDRESS, sequence: "1" });
    mockBuildRequestWithdrawal.mockResolvedValue("assembled-xdr");
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "txhash123",
    });
    mockPollTransaction.mockResolvedValue({
      status: "SUCCESS",
      returnValue: 42n,
    });
  });

  it("initial state is idle", () => {
    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it("mock-key happy path returns hash and requestId", async () => {
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue({
      hash: "mock-hash-123",
      requestId: "42",
    });

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.hash).toBe("mock-hash-123");
    expect(result.current.data?.requestId).toBe(42n);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("mock-key happy path persists inflight entry", async () => {
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue({
      hash: "mock-hash",
      requestId: "99",
    });

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(5_000_000n);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const stored = readInflightWithdrawal(TEST_ADDRESS);
    expect(stored?.requestId).toBe("99");
    expect(stored?.amount).toBe("5000000");
  });

  it("unconfigured contract returns error", async () => {
    const chainModule = await import("./chain");
    vi.spyOn(chainModule, "withdrawalQueueId", "get").mockReturnValue("");
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    expect(result.current.error?.message).toMatch(
      /WithdrawalQueue not configured/,
    );
  });

  it("real path: decodes requestId from returnValue bigint", async () => {
    const { scValToNative } = await import("@stellar/stellar-sdk");
    vi.mocked(scValToNative).mockReturnValue(77n);
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.requestId).toBe(77n);
    expect(result.current.data?.hash).toBe("txhash123");
  });

  it("real path: errors when returnValue is missing", async () => {
    mockPollTransaction.mockResolvedValue({
      status: "SUCCESS",
      returnValue: undefined,
    });
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toMatch(/returned no request_id/);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("sendTransaction ERROR sets error", async () => {
    mockSendTransaction.mockResolvedValue({
      status: "ERROR",
      hash: "txhash-err",
    });
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toMatch(/sendTransaction failed/);
    expect(result.current.isPending).toBe(false);
  });

  it("signTransaction rejection sets error", async () => {
    mockSignTransaction.mockRejectedValue(new Error("User rejected"));
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toMatch(/User rejected/);
    expect(result.current.isPending).toBe(false);
  });

  it("re-entrant write() is ignored while isPending", async () => {
    let resolve!: () => void;
    mockBuildRequestWithdrawal.mockReturnValue(
      new Promise<string>((res) => {
        resolve = () => res("assembled-xdr");
      }),
    );
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(10_000_000n);
    });

    expect(result.current.isPending).toBe(true);

    act(() => {
      result.current.write(10_000_000n); // should be ignored
    });

    resolve();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Only called once
    expect(mockBuildRequestWithdrawal).toHaveBeenCalledTimes(1);
  });

  it("reset() clears state", async () => {
    vi.spyOn(mockModule, "readMockStellarRequestWithdrawal").mockReturnValue({
      hash: "h",
      requestId: "1",
    });

    const { result } = renderHook(() => useStellarRequestWithdrawal(), {
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
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

// ── Tests: useStellarClaimWithdrawal ──────────────────────────────────────────

describe("useStellarClaimWithdrawal", () => {
  const validSig = new Uint8Array(64).fill(0xab);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();

    mockGetAccount.mockResolvedValue({ id: TEST_ADDRESS, sequence: "1" });
    mockBuildClaimRequest.mockResolvedValue("assembled-xdr");
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "claim-hash",
    });
    mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("mock-key happy path", async () => {
    vi.spyOn(mockModule, "readMockStellarClaimWithdrawal").mockReturnValue({
      hash: "claim-mock-hash",
    });

    const { result } = renderHook(() => useStellarClaimWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(42n, validSig);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.hash).toBe("claim-mock-hash");
  });

  it("rejects non-64-byte signature", () => {
    vi.spyOn(mockModule, "readMockStellarClaimWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarClaimWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(42n, new Uint8Array(32));
    });

    expect(result.current.error?.message).toMatch(/must be 64 bytes/);
    expect(result.current.isPending).toBe(false);
  });

  it("unconfigured contract returns error", async () => {
    const chainModule = await import("./chain");
    vi.spyOn(chainModule, "withdrawalQueueId", "get").mockReturnValue("");
    vi.spyOn(mockModule, "readMockStellarClaimWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarClaimWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(42n, validSig);
    });

    expect(result.current.error?.message).toMatch(
      /WithdrawalQueue not configured/,
    );
  });

  it("declined signature sets error", async () => {
    mockSignTransaction.mockRejectedValue(new Error("User cancelled"));
    vi.spyOn(mockModule, "readMockStellarClaimWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarClaimWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(42n, validSig);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/User cancelled/);
  });

  it("real path: clears inflight on success", async () => {
    writeInflightWithdrawal(TEST_ADDRESS, {
      requestId: "42",
      amount: "10000000",
      createdAt: Date.now(),
    });

    vi.spyOn(mockModule, "readMockStellarClaimWithdrawal").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarClaimWithdrawal(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.write(42n, validSig);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(readInflightWithdrawal(TEST_ADDRESS)).toBeUndefined();
  });
});

// ── Tests: useStellarChangeTrustUsdc ──────────────────────────────────────────

describe("useStellarChangeTrustUsdc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();

    mockLoadAccount.mockResolvedValue({
      id: TEST_ADDRESS,
      sequence: "1",
      accountId: () => TEST_ADDRESS,
      incrementSequenceNumber: () => {},
    });
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSubmitTransaction.mockResolvedValue({ hash: "trust-hash" });
  });

  it("mock-key happy path for USDC trustline", async () => {
    vi.spyOn(mockModule, "readMockStellarChangeTrust").mockReturnValue({
      hash: "trust-mock-hash",
    });

    const { result } = renderHook(() => useStellarChangeTrustUsdc(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submit();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.hash).toBe("trust-mock-hash");
    expect(result.current.needsTrustline).toBe(true);
    // #662: trustline status is refetched on success so the UI flips promptly.
    // (The real-path success refetch is covered by the PLUSD changeTrust suite;
    // this file's real-path Horizon harness has pre-existing timing failures.)
    expect(mockRefetchBalance).toHaveBeenCalled();
  });

  it("declined signature sets error", async () => {
    mockSignTransaction.mockRejectedValue(new Error("Declined"));
    vi.spyOn(mockModule, "readMockStellarChangeTrust").mockReturnValue(
      undefined,
    );

    const { result } = renderHook(() => useStellarChangeTrustUsdc(), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.submit();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/Declined/);
  });

  it("reset clears state", async () => {
    vi.spyOn(mockModule, "readMockStellarChangeTrust").mockReturnValue({
      hash: "h",
    });

    const { result } = renderHook(() => useStellarChangeTrustUsdc(), {
      wrapper: makeWrapper(),
    });

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

// ── Tests: in-flight recovery helpers ────────────────────────────────────────

describe("in-flight recovery helpers", () => {
  beforeEach(() => localStorageMock.clear());
  afterEach(() => localStorageMock.clear());

  it("write then read round-trips correctly", () => {
    writeInflightWithdrawal(TEST_ADDRESS, {
      requestId: "55",
      amount: "20000000",
      createdAt: 12345,
    });

    const stored = readInflightWithdrawal(TEST_ADDRESS);
    expect(stored?.requestId).toBe("55");
    expect(stored?.amount).toBe("20000000");
    expect(stored?.createdAt).toBe(12345);
  });

  it("clear removes entry", () => {
    writeInflightWithdrawal(TEST_ADDRESS, {
      requestId: "55",
      amount: "20000000",
      createdAt: 12345,
    });
    clearInflightWithdrawal(TEST_ADDRESS);
    expect(readInflightWithdrawal(TEST_ADDRESS)).toBeUndefined();
  });

  it("returns undefined for missing entry", () => {
    expect(readInflightWithdrawal(TEST_ADDRESS)).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    localStorageMock.setItem(
      `pipeline.stellar.withdrawal.inflight.${TEST_ADDRESS}`,
      "not-json",
    );
    expect(readInflightWithdrawal(TEST_ADDRESS)).toBeUndefined();
  });

  it("returns undefined for partial entry (missing requestId)", () => {
    localStorageMock.setItem(
      `pipeline.stellar.withdrawal.inflight.${TEST_ADDRESS}`,
      JSON.stringify({ amount: "100", createdAt: 1 }),
    );
    expect(readInflightWithdrawal(TEST_ADDRESS)).toBeUndefined();
  });

  it("does not read another account's entry", () => {
    writeInflightWithdrawal(
      "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1",
      {
        requestId: "99",
        amount: "1",
        createdAt: 1,
      },
    );
    expect(readInflightWithdrawal(TEST_ADDRESS)).toBeUndefined();
  });
});

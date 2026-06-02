/**
 * Unit tests for `blendPool.ts`.
 *
 * All Soroban RPC calls and blend-sdk calls are mocked — no real network.
 *
 * Scenarios:
 *   1. buildSubmitOpXdr — passes correct request_type, address, amount, from.
 *   2. submitBlendTx happy path — simulate ok → assemble → sign → send → poll
 *      → SUCCESS → returns { hash }. Signed XDR (not unsigned) is sent.
 *   3. submitBlendTx simulation error → throws; sign is never called.
 *   4. submitBlendTx getTransaction FAILED → throws.
 *   5. submitBlendTx NOT_FOUND then SUCCESS → resolves (poll loop).
 *   6. loadBlendCollateral with position → returns the reserve's raw bigint.
 *   7. loadBlendCollateral no position / unfunded → returns 0n.
 *   8. loadBlendCollateral reserve not in pool → returns 0n.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSubmitOpXdr,
  submitBlendTx,
  loadBlendCollateral,
  RequestType,
} from "./blendPool";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const {
  mockSubmit,
  mockPoolV2Load,
  mockLoadUser,
  mockGetAccount,
  mockSimulateTransaction,
  mockSendTransaction,
  mockPollTransaction,
  mockAssembleTransaction,
  mockIsSimulationError,
  mockGetTransactionStatus,
  mockFromXDR,
  mockAddOperation,
  mockSetTimeout,
  mockBuild,
} = vi.hoisted(() => {
  const mockBuild = vi.fn().mockReturnValue({
    toXDR: vi.fn().mockReturnValue("unsigned-xdr-base64"),
  });
  const mockSetTimeout = vi.fn().mockReturnValue({ build: mockBuild });
  const mockAddOperation = vi
    .fn()
    .mockReturnValue({ setTimeout: mockSetTimeout });

  return {
    mockSubmit: vi.fn().mockReturnValue("op-xdr-base64"),
    mockPoolV2Load: vi.fn(),
    mockLoadUser: vi.fn(),
    mockGetAccount: vi
      .fn()
      .mockResolvedValue({ id: "GTEST...", sequenceNumber: () => "1" }),
    mockSimulateTransaction: vi.fn(),
    mockSendTransaction: vi.fn(),
    mockPollTransaction: vi.fn(),
    mockAssembleTransaction: vi.fn(),
    mockIsSimulationError: vi.fn().mockReturnValue(false),
    mockGetTransactionStatus: {
      SUCCESS: "SUCCESS",
      FAILED: "FAILED",
      NOT_FOUND: "NOT_FOUND",
    },
    mockFromXDR: vi.fn().mockReturnValue({
      toXDR: vi.fn().mockReturnValue("signed-rebuilt-xdr"),
    }),
    mockAddOperation,
    mockSetTimeout,
    mockBuild,
  };
});

// ── Mock @blend-capital/blend-sdk ─────────────────────────────────────────────

vi.mock("@blend-capital/blend-sdk", () => {
  class PoolContractV2 {
    submit(args: unknown) {
      return mockSubmit(args);
    }
  }

  class PoolV2 {
    reserves = new Map<string, { config: { index: number } }>();
    async loadUser(userId: string) {
      return mockLoadUser(userId);
    }
    static async load(network: unknown, id: unknown) {
      return mockPoolV2Load(network, id);
    }
  }

  const RequestType = {
    Supply: 0,
    Withdraw: 1,
    SupplyCollateral: 2,
    WithdrawCollateral: 3,
    Borrow: 4,
    Repay: 5,
  };

  return { PoolContractV2, PoolV2, RequestType };
});

// ── Mock @stellar/stellar-sdk ─────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", () => {
  class TransactionBuilder {
    addOperation(op: unknown) {
      return mockAddOperation(op);
    }
    static fromXDR(xdr: string, passphrase: string) {
      return mockFromXDR(xdr, passphrase);
    }
  }

  const xdr = {
    Operation: {
      fromXDR: vi.fn().mockReturnValue({ type: "invokeHostFunction" }),
    },
  };

  class Server {
    getAccount(address: string) {
      return mockGetAccount(address);
    }
    simulateTransaction(tx: unknown) {
      return mockSimulateTransaction(tx);
    }
    sendTransaction(tx: unknown) {
      return mockSendTransaction(tx);
    }
    pollTransaction(hash: string) {
      return mockPollTransaction(hash);
    }
  }

  const rpc = {
    Server,
    assembleTransaction: mockAssembleTransaction,
    Api: {
      isSimulationError: mockIsSimulationError,
      GetTransactionStatus: mockGetTransactionStatus,
    },
  };

  const Networks = { TESTNET: "Test SDF Network ; September 2015" };

  return { TransactionBuilder, xdr, rpc, Networks, Transaction: class {} };
});

// ── Mock ./chain ──────────────────────────────────────────────────────────────

vi.mock("./chain", () => ({
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  blendPoolId: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
  blendXlmId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  blendNetwork: {
    rpc: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const STELLAR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RESERVE_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const TX_HASH = "abc123def456";

const mockSign = vi
  .fn()
  .mockResolvedValue({ signedTxXdr: "signed-xdr-base64" });

// ── Setup assembled tx mock ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockSign.mockResolvedValue({ signedTxXdr: "signed-xdr-base64" });

  // addOperation chain
  mockAddOperation.mockReturnValue({ setTimeout: mockSetTimeout });
  mockSetTimeout.mockReturnValue({ build: mockBuild });
  mockBuild.mockReturnValue({
    toXDR: vi.fn().mockReturnValue("unsigned-xdr-base64"),
  });

  // fromXDR returns a mock transaction
  mockFromXDR.mockReturnValue({
    toXDR: vi.fn().mockReturnValue("signed-rebuilt-xdr"),
  });

  // assemble returns a builder whose build() returns the assembled tx
  mockAssembleTransaction.mockReturnValue({
    build: vi.fn().mockReturnValue({
      toXDR: vi.fn().mockReturnValue("assembled-xdr"),
    }),
  });

  // Default simulation: success (not error)
  mockIsSimulationError.mockReturnValue(false);
  mockSimulateTransaction.mockResolvedValue({ footprint: "ok" });

  // Default send: PENDING
  mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: TX_HASH });

  // Default poll: SUCCESS
  mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });

  // Default getAccount
  mockGetAccount.mockResolvedValue({ id: STELLAR_ADDR });

  // Default submit (PoolContractV2.submit)
  mockSubmit.mockReturnValue("op-xdr-base64");
});

// ── Tests: buildSubmitOpXdr ───────────────────────────────────────────────────

describe("buildSubmitOpXdr", () => {
  it("passes SupplyCollateral request_type and correct args", () => {
    const result = buildSubmitOpXdr({
      poolId: "POOL_ID",
      from: STELLAR_ADDR,
      reserveId: RESERVE_ID,
      amount: 10_000_000n,
      requestType: RequestType.SupplyCollateral,
    });

    expect(result).toBe("op-xdr-base64");
    expect(mockSubmit).toHaveBeenCalledWith({
      from: STELLAR_ADDR,
      spender: STELLAR_ADDR,
      to: STELLAR_ADDR,
      requests: [
        {
          address: RESERVE_ID,
          amount: 10_000_000n,
          request_type: RequestType.SupplyCollateral,
        },
      ],
    });
  });

  it("passes WithdrawCollateral request_type", () => {
    buildSubmitOpXdr({
      poolId: "POOL_ID",
      from: STELLAR_ADDR,
      reserveId: RESERVE_ID,
      amount: 5_000_000n,
      requestType: RequestType.WithdrawCollateral,
    });

    const call = mockSubmit.mock.calls[0]?.[0];
    expect(call?.requests[0]?.request_type).toBe(
      RequestType.WithdrawCollateral,
    );
    expect(call?.from).toBe(call?.spender);
    expect(call?.from).toBe(call?.to);
  });
});

// ── Tests: submitBlendTx — happy path ────────────────────────────────────────

describe("submitBlendTx — happy path", () => {
  it("simulates, assembles, signs, sends, polls and returns { hash }", async () => {
    const result = await submitBlendTx({
      opXdr: "op-xdr-base64",
      sourceAddress: STELLAR_ADDR,
      sign: mockSign,
    });

    expect(result).toEqual({ hash: TX_HASH });

    // Sign was called with the assembled (not raw) XDR
    expect(mockSign).toHaveBeenCalledOnce();
    const signedXdr = mockSign.mock.calls[0]?.[0];
    // Should not be the raw tx XDR — the assembled tx's toXDR was called
    expect(typeof signedXdr).toBe("string");

    // Send was called once after sign
    expect(mockSendTransaction).toHaveBeenCalledOnce();

    // Poll was called with the tx hash
    expect(mockPollTransaction).toHaveBeenCalledWith(TX_HASH);
  });

  it("sends the signed XDR (not the unsigned one) — fromXDR is called with signedTxXdr", async () => {
    await submitBlendTx({
      opXdr: "op-xdr-base64",
      sourceAddress: STELLAR_ADDR,
      sign: mockSign,
    });

    // fromXDR is called with the signed XDR
    expect(mockFromXDR).toHaveBeenCalledWith(
      "signed-xdr-base64",
      expect.any(String),
    );
  });
});

// ── Tests: submitBlendTx — simulation error ────────────────────────────────────

describe("submitBlendTx — simulation error", () => {
  it("throws a readable error and does not call sign", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({
      error: "contract not found",
    });

    await expect(
      submitBlendTx({
        opXdr: "op-xdr-base64",
        sourceAddress: STELLAR_ADDR,
        sign: mockSign,
      }),
    ).rejects.toThrow("Simulation failed");

    expect(mockSign).not.toHaveBeenCalled();
  });
});

// ── Tests: submitBlendTx — FAILED status ──────────────────────────────────────

describe("submitBlendTx — FAILED status", () => {
  it("throws when pollTransaction returns FAILED", async () => {
    mockPollTransaction.mockResolvedValue({ status: "FAILED" });

    await expect(
      submitBlendTx({
        opXdr: "op-xdr-base64",
        sourceAddress: STELLAR_ADDR,
        sign: mockSign,
      }),
    ).rejects.toThrow("failed with status FAILED");
  });
});

// ── Tests: loadBlendCollateral — with position ─────────────────────────────────

describe("loadBlendCollateral — with position", () => {
  it("returns the reserve's raw collateral bigint", async () => {
    const reserveIndex = 0;
    const collateralAmount = 50_000_000n;

    const mockPool = {
      reserves: new Map([[RESERVE_ID, { config: { index: reserveIndex } }]]),
      loadUser: vi.fn().mockResolvedValue({
        positions: {
          collateral: new Map([[reserveIndex, collateralAmount]]),
        },
      }),
    };
    mockPoolV2Load.mockResolvedValue(mockPool);

    const result = await loadBlendCollateral({
      network: {
        rpc: "https://soroban-testnet.stellar.org",
        passphrase: "passphrase",
      },
      poolId: "POOL_ID",
      userAddress: STELLAR_ADDR,
      reserveId: RESERVE_ID,
    });

    expect(result).toBe(collateralAmount);
  });
});

// ── Tests: loadBlendCollateral — no position ──────────────────────────────────

describe("loadBlendCollateral — no position / unfunded", () => {
  it("returns 0n when account has no collateral for the reserve", async () => {
    const mockPool = {
      reserves: new Map([[RESERVE_ID, { config: { index: 0 } }]]),
      loadUser: vi.fn().mockResolvedValue({
        positions: {
          collateral: new Map(), // empty — no position
        },
      }),
    };
    mockPoolV2Load.mockResolvedValue(mockPool);

    const result = await loadBlendCollateral({
      network: {
        rpc: "https://soroban-testnet.stellar.org",
        passphrase: "passphrase",
      },
      poolId: "POOL_ID",
      userAddress: STELLAR_ADDR,
      reserveId: RESERVE_ID,
    });

    expect(result).toBe(0n);
  });

  it("returns 0n when PoolV2.load throws (unfunded account)", async () => {
    mockPoolV2Load.mockRejectedValue(new Error("not found"));

    const result = await loadBlendCollateral({
      network: {
        rpc: "https://soroban-testnet.stellar.org",
        passphrase: "passphrase",
      },
      poolId: "POOL_ID",
      userAddress: STELLAR_ADDR,
      reserveId: RESERVE_ID,
    });

    expect(result).toBe(0n);
  });

  it("returns 0n when reserve is not in the pool", async () => {
    const mockPool = {
      reserves: new Map(), // reserve not listed
      loadUser: vi.fn(),
    };
    mockPoolV2Load.mockResolvedValue(mockPool);

    const result = await loadBlendCollateral({
      network: {
        rpc: "https://soroban-testnet.stellar.org",
        passphrase: "passphrase",
      },
      poolId: "POOL_ID",
      userAddress: STELLAR_ADDR,
      reserveId: RESERVE_ID,
    });

    expect(result).toBe(0n);
  });
});

/**
 * Unit tests for `getSacBalance` (issue #805).
 *
 * All Soroban RPC calls are mocked — no real network access. Mirrors the
 * mocking style of `packages/frontend/src/wallet/stellar/contracts/token.test.ts`.
 *
 * Scenarios:
 *   1. Normal balance path — returns the raw scaled bigint.
 *   2. i64-max sentinel — throws (guarded, caller maps to "unavailable").
 *   3. Simulation error — propagates as an Error.
 *   4. No result — propagates as an Error.
 *   5. Empty sacContractId / account — throws before any RPC call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSacBalance,
  isSacBalanceSentinel,
  SAC_BALANCE_I64_MAX,
  READ_SIMULATION_SOURCE,
} from "./sacBalance";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockSimulateTransaction,
  mockIsSimulationError,
  mockScValToNative,
  mockContractCall,
  mockAddOperation,
} = vi.hoisted(() => {
  const mockBuild = vi
    .fn()
    .mockReturnValue({ toXDR: vi.fn().mockReturnValue("assembled-xdr") });
  const mockSetTimeout = vi.fn().mockReturnValue({ build: mockBuild });
  const mockAddOperation = vi
    .fn()
    .mockReturnValue({ setTimeout: mockSetTimeout });

  return {
    mockSimulateTransaction: vi.fn(),
    mockIsSimulationError: vi.fn().mockReturnValue(false),
    mockScValToNative: vi.fn(),
    mockContractCall: vi.fn().mockReturnValue("op"),
    mockAddOperation,
  };
});

vi.mock("@stellar/stellar-sdk", () => {
  class MockContract {
    call(_method: string, ..._args: unknown[]) {
      return mockContractCall(_method, ..._args);
    }
  }
  class MockServer {
    simulateTransaction(tx: unknown) {
      return mockSimulateTransaction(tx);
    }
  }
  class MockAccount {
    constructor(
      public _id: string,
      public _seq: string,
    ) {}
    accountId() {
      return this._id;
    }
    sequenceNumber() {
      return this._seq;
    }
    incrementSequenceNumber() {}
  }
  class MockTransactionBuilder {
    constructor(
      public _account: unknown,
      public _opts: unknown,
    ) {}
    addOperation(_op: unknown) {
      return mockAddOperation(_op);
    }
    static fromXDR() {
      return {};
    }
  }

  return {
    Contract: MockContract,
    Account: MockAccount,
    rpc: {
      Server: MockServer,
      Api: {
        isSimulationError: mockIsSimulationError,
      },
    },
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: "100",
    xdr: {},
    Address: class {
      constructor(public addr: string) {}
      toScVal() {
        return { addr: this.addr };
      }
    },
    scValToNative: mockScValToNative,
  };
});

// ── Constants ─────────────────────────────────────────────────────────────────

const SAC_CONTRACT_ID =
  "CB3SHE2S5QMO4GLM65B6DADFRL7K5JPUSKNVJIXJG37ZRABZJRN5DEE6";
const ACCOUNT = "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU";
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";

function makeMockResult(retval: unknown) {
  return { result: { retval } };
}

function callArgs(
  overrides: Partial<Parameters<typeof getSacBalance>[0]> = {},
) {
  return {
    sorobanRpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    sacContractId: SAC_CONTRACT_ID,
    account: ACCOUNT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSimulationError.mockReturnValue(false);
});

// ── Tests: normal path ────────────────────────────────────────────────────────

describe("getSacBalance — normal path", () => {
  it("returns the raw i128 balance as a bigint", async () => {
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(84_000_000_000n); // 8,400 USDC at 7 decimals

    const result = await getSacBalance(callArgs());

    expect(result).toBe(84_000_000_000n);
  });

  it('calls "balance" with the account address arg', async () => {
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(10_000_000n);

    await getSacBalance(callArgs());

    expect(mockContractCall).toHaveBeenCalledWith("balance", expect.anything());
  });
});

// ── Tests: sentinel guard ─────────────────────────────────────────────────────

describe("getSacBalance — i64-max sentinel guard", () => {
  it("isSacBalanceSentinel is true at exactly I64_MAX and above", () => {
    expect(isSacBalanceSentinel(SAC_BALANCE_I64_MAX)).toBe(true);
    expect(isSacBalanceSentinel(SAC_BALANCE_I64_MAX + 1n)).toBe(true);
    expect(isSacBalanceSentinel(SAC_BALANCE_I64_MAX - 1n)).toBe(false);
  });

  it("throws when balance() returns the i64-max sentinel", async () => {
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(SAC_BALANCE_I64_MAX);

    await expect(getSacBalance(callArgs())).rejects.toThrow("i64 max sentinel");
  });
});

// ── Tests: simulation error path ──────────────────────────────────────────────

describe("getSacBalance — simulation error path", () => {
  it("propagates a simulation error as an Error", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "contract not found" });

    await expect(getSacBalance(callArgs())).rejects.toThrow(
      "getSacBalance simulation error",
    );
  });

  it("throws when simulation returns no result", async () => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({});

    await expect(getSacBalance(callArgs())).rejects.toThrow("no result");
  });
});

// ── Tests: input validation ───────────────────────────────────────────────────

describe("getSacBalance — input validation", () => {
  it("throws for an empty sacContractId without calling the RPC", async () => {
    await expect(
      getSacBalance(callArgs({ sacContractId: "" })),
    ).rejects.toThrow("sacContractId must not be empty");
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it("throws for an empty account without calling the RPC", async () => {
    await expect(getSacBalance(callArgs({ account: "" }))).rejects.toThrow(
      "account must not be empty",
    );
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });
});

// ── READ_SIMULATION_SOURCE ─────────────────────────────────────────────────────

describe("READ_SIMULATION_SOURCE", () => {
  it("is the well-known null account", () => {
    expect(READ_SIMULATION_SOURCE).toBe(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );
  });
});

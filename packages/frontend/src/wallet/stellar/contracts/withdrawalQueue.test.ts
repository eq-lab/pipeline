// spec: docs/frontend/wallet-flows.md#withdrawal-queue-reads
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WithdrawalQueueClient } from "./withdrawalQueue";

const {
  mockSimulateTransaction,
  mockIsSimulationError,
  mockScValToNative,
  mockNativeToScVal,
  mockContractCall,
  accountArgs,
} = vi.hoisted(() => ({
  mockSimulateTransaction: vi.fn(),
  mockIsSimulationError: vi.fn().mockReturnValue(false),
  mockScValToNative: vi.fn(),
  mockNativeToScVal: vi.fn((value: unknown, opts: unknown) => ({
    value,
    opts,
  })),
  mockContractCall: vi.fn().mockReturnValue("op"),
  accountArgs: [] as string[],
}));

vi.mock("@stellar/stellar-sdk", () => {
  class MockContract {
    call(method: string, ...args: unknown[]) {
      return mockContractCall(method, ...args);
    }
  }
  class MockServer {
    simulateTransaction(tx: unknown) {
      return mockSimulateTransaction(tx);
    }
  }
  class MockAccount {
    constructor(id: string) {
      accountArgs.push(id);
    }
  }
  class MockTransactionBuilder {
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return {};
    }
  }
  return {
    Contract: MockContract,
    Account: MockAccount,
    rpc: {
      Server: MockServer,
      Api: { isSimulationError: mockIsSimulationError },
    },
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: "100",
    xdr: { ScVal: { scvBytes: vi.fn().mockReturnValue({ bytes: true }) } },
    Address: class {
      toScVal() {
        return {};
      }
    },
    nativeToScVal: mockNativeToScVal,
    scValToNative: mockScValToNative,
  };
});

vi.mock("../chain", () => ({
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  READ_SIMULATION_SOURCE:
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
}));

const CONTRACT_ID = "CBVXUTESTCONTRACT";
const SENDER = "GSENDER";

function simulateReturns(value: unknown) {
  mockSimulateTransaction.mockResolvedValue({ result: { retval: "retval" } });
  mockScValToNative.mockReturnValue(value);
}

describe("WithdrawalQueueClient queue reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountArgs.length = 0;
    mockIsSimulationError.mockReturnValue(false);
  });

  it.each([
    ["rate", "rate", 1_000_000n],
    ["totalQueued", "total_queued", 10_000_000_000n],
    ["totalClaimed", "total_claimed", 5n],
  ] as const)("%s calls %s and decodes i128", async (method, name, value) => {
    simulateReturns(value);
    const client = new WithdrawalQueueClient(CONTRACT_ID);
    expect(await client[method]()).toBe(value);
    expect(mockContractCall).toHaveBeenCalledWith(name);
  });

  it("claimable passes a u128 id and decodes the bool", async () => {
    simulateReturns(true);
    const client = new WithdrawalQueueClient(CONTRACT_ID);
    expect(await client.claimable(7n)).toBe(true);
    expect(mockNativeToScVal).toHaveBeenCalledWith(7n, { type: "u128" });
    expect(mockContractCall.mock.calls[0]![0]).toBe("claimable");
  });

  it("withdrawalRequestQueued passes a u128 id and decodes i128", async () => {
    simulateReturns(10_000_000_000n);
    const client = new WithdrawalQueueClient(CONTRACT_ID);
    expect(await client.withdrawalRequestQueued(0n)).toBe(10_000_000_000n);
    expect(mockNativeToScVal).toHaveBeenCalledWith(0n, { type: "u128" });
    expect(mockContractCall.mock.calls[0]![0]).toBe(
      "withdrawal_request_queued",
    );
  });

  it("simulateClaimPayout simulates claim_request from the sender and returns the retval", async () => {
    simulateReturns(9_500_000n);
    const client = new WithdrawalQueueClient(CONTRACT_ID);
    const payout = await client.simulateClaimPayout(
      SENDER,
      3n,
      new Uint8Array(64),
      99n,
    );
    expect(payout).toBe(9_500_000n);
    expect(accountArgs).toContain(SENDER);
    expect(mockContractCall.mock.calls[0]![0]).toBe("claim_request");
    expect(mockNativeToScVal).toHaveBeenCalledWith(3n, { type: "u128" });
    expect(mockNativeToScVal).toHaveBeenCalledWith(99n, { type: "u64" });
  });

  it("simulateClaimPayout throws on a simulation error", async () => {
    mockSimulateTransaction.mockResolvedValue({ error: "Error(Contract, #2)" });
    mockIsSimulationError.mockReturnValue(true);
    const client = new WithdrawalQueueClient(CONTRACT_ID);
    await expect(
      client.simulateClaimPayout(SENDER, 3n, new Uint8Array(64), 99n),
    ).rejects.toThrow("Error(Contract, #2)");
  });
});

/**
 * Unit tests for `TokenClient` and `createTokenClient`.
 *
 * All Soroban RPC calls are mocked — no real network access.
 *
 * Scenarios:
 *   1. createTokenClient("") → null.
 *   2. createTokenClient(id)  → TokenClient.
 *   3. TokenClient constructor — throws for empty contractId.
 *   4. totalSupply() — decodes i128 → bigint; calls "total_supply".
 *   5. balance(account) — decodes i128 → bigint; calls "balance" with address arg.
 *   6. Simulation error path — throws with descriptive message.
 *   7. No result path — throws "no result".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TokenClient, createTokenClient } from "./token";

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

vi.mock("../chain", () => ({
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  READ_SIMULATION_SOURCE:
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTRACT_ID = "CBVAYH66RIGA5PKSGHKKGOOQDUPKNVFYBW6P7CGMDX4SD7BI7TXUXSKI";
const ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockResult(retval: unknown) {
  return { result: { retval } };
}

// ── Tests: createTokenClient ──────────────────────────────────────────────────

describe("createTokenClient", () => {
  it("returns null for empty contractId", () => {
    expect(createTokenClient("")).toBeNull();
  });

  it("returns a TokenClient for a non-empty contractId", () => {
    const client = createTokenClient(CONTRACT_ID);
    expect(client).toBeInstanceOf(TokenClient);
  });
});

// ── Tests: constructor ────────────────────────────────────────────────────────

describe("TokenClient constructor", () => {
  it("throws for empty contractId", () => {
    expect(() => new TokenClient("")).toThrow("contractId must not be empty");
  });
});

// ── Tests: totalSupply() ──────────────────────────────────────────────────────

describe("TokenClient.totalSupply()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(431_400_000_000_000n);
  });

  it("returns total supply as bigint", async () => {
    const client = new TokenClient(CONTRACT_ID);
    const result = await client.totalSupply();
    expect(result).toBe(431_400_000_000_000n);
  });

  it('calls "total_supply" method on the contract', async () => {
    const client = new TokenClient(CONTRACT_ID);
    await client.totalSupply();
    expect(mockContractCall).toHaveBeenCalledWith("total_supply");
  });

  it("decodes i128 bigint correctly (7-decimal scale)", async () => {
    // 1 PLUSD = 10_000_000n at 7 decimals
    mockScValToNative.mockReturnValue(10_000_000n);
    const client = new TokenClient(CONTRACT_ID);
    const result = await client.totalSupply();
    expect(result).toBe(10_000_000n);
  });
});

// ── Tests: balance() ─────────────────────────────────────────────────────────

describe("TokenClient.balance()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(50_000_000_000n);
  });

  it("returns token balance as bigint", async () => {
    const client = new TokenClient(CONTRACT_ID);
    const result = await client.balance(ACCOUNT);
    expect(result).toBe(50_000_000_000n);
  });

  it('calls "balance" method with the account address arg', async () => {
    const client = new TokenClient(CONTRACT_ID);
    await client.balance(ACCOUNT);
    expect(mockContractCall).toHaveBeenCalledWith("balance", expect.anything());
  });
});

// ── Tests: simulation error path ─────────────────────────────────────────────

describe("TokenClient — simulation error path", () => {
  it("throws with descriptive message when isSimulationError is true", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "contract not found" });

    const client = new TokenClient(CONTRACT_ID);
    await expect(client.totalSupply()).rejects.toThrow(
      "TokenClient simulation error",
    );
  });
});

// ── Tests: no result path ─────────────────────────────────────────────────────

describe("TokenClient — no result path", () => {
  it("throws when simulation returns no result", async () => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({}); // no `result` field

    const client = new TokenClient(CONTRACT_ID);
    await expect(client.totalSupply()).rejects.toThrow("no result");
  });
});

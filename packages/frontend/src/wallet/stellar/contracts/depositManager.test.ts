/**
 * Unit tests for `DepositManagerClient` and `createDepositManagerClient`.
 *
 * All Soroban RPC calls are mocked — no real network access.
 *
 * Scenarios:
 *   1. createDepositManagerClient — returns null for empty contractId.
 *   2. createDepositManagerClient — returns client for non-empty contractId.
 *   3. DepositManagerClient constructor — throws for empty contractId.
 *   4. asset() — decodes mocked simulation result.
 *   5. share() — decodes mocked simulation result.
 *   6. paused() — decodes boolean result.
 *   7. verifier() — decodes bytes result.
 *   8. getRequest() — decodes Request struct.
 *   9. buildRequestDeposit — returns assembled XDR; throws on simulation error.
 *  10. buildClaimRequest — validates 64-byte signature; throws on simulation error.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DepositManagerClient,
  createDepositManagerClient,
} from "./depositManager";
import type { Account } from "@stellar/stellar-sdk";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockSimulateTransaction,
  mockAssembleTransaction,
  mockIsSimulationError,
  mockScValToNative,
  mockNativeToScVal,
  mockContractCall,
  mockScvBytes,
  mockBuild,
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
    mockAssembleTransaction: vi.fn(),
    mockIsSimulationError: vi.fn().mockReturnValue(false),
    mockScValToNative: vi.fn(),
    mockNativeToScVal: vi.fn().mockReturnValue({}),
    mockContractCall: vi.fn().mockReturnValue("op"),
    mockScvBytes: vi.fn().mockReturnValue({}),
    mockBuild,
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
      assembleTransaction: mockAssembleTransaction,
    },
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: "100",
    xdr: {
      ScVal: {
        scvBytes: mockScvBytes,
      },
    },
    Address: class {
      constructor(public addr: string) {}
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

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTRACT_ID = "CARFA2QETOZVKHSG4BCEEXMJHTYR2Z75VR7WQNX4MWZ33RQMKRKATIVI";
const USDC_ID = "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7";
const PLUSD_ID = "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockResult(retval: unknown) {
  return { result: { retval } };
}

// ── Tests: createDepositManagerClient ─────────────────────────────────────────

describe("createDepositManagerClient", () => {
  it("returns null for empty contractId", () => {
    expect(createDepositManagerClient("")).toBeNull();
  });

  it("returns a DepositManagerClient for a non-empty contractId", () => {
    const client = createDepositManagerClient(CONTRACT_ID);
    expect(client).toBeInstanceOf(DepositManagerClient);
  });
});

// ── Tests: constructor ────────────────────────────────────────────────────────

describe("DepositManagerClient constructor", () => {
  it("throws for empty contractId", () => {
    expect(() => new DepositManagerClient("")).toThrow(
      "VITE_STELLAR_DEPOSIT_MANAGER_ID",
    );
  });
});

// ── Tests: read views ─────────────────────────────────────────────────────────

describe("DepositManagerClient.asset()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(USDC_ID);
  });

  it("returns the USDC contract ID from simulation result", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    const result = await client.asset();
    expect(result).toBe(USDC_ID);
    expect(mockContractCall).toHaveBeenCalledWith("asset");
  });
});

describe("DepositManagerClient.share()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(PLUSD_ID);
  });

  it("returns the PLUSD contract ID from simulation result", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    const result = await client.share();
    expect(result).toBe(PLUSD_ID);
    expect(mockContractCall).toHaveBeenCalledWith("share");
  });
});

describe("DepositManagerClient.paused()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(false);
  });

  it("returns false when contract is not paused", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    const result = await client.paused();
    expect(result).toBe(false);
  });
});

describe("DepositManagerClient.verifier()", () => {
  const mockVerifierBytes = new Uint8Array(32).fill(0xab);

  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(mockVerifierBytes);
  });

  it("returns 32-byte verifier key", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    const result = await client.verifier();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });
});

describe("DepositManagerClient.getRequest()", () => {
  const mockRequest = {
    amount: 10_000_000n,
    claimed: false,
    timestamp: 1234567890n,
    user: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV",
  };

  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(mockRequest);
  });

  it("decodes the Request struct correctly", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    const result = await client.getRequest(42n);
    expect(result.amount).toBe(10_000_000n);
    expect(result.claimed).toBe(false);
    expect(result.timestamp).toBe(1234567890n);
    expect(result.user).toBe(mockRequest.user);
    expect(mockContractCall).toHaveBeenCalledWith(
      "get_request",
      expect.anything(),
    );
  });
});

// ── Tests: simulation error ───────────────────────────────────────────────────

describe("DepositManagerClient — simulation error", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "contract error" });
  });

  it("throws when simulation returns an error", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    await expect(client.asset()).rejects.toThrow("simulation error");
  });
});

// ── Tests: write builders ─────────────────────────────────────────────────────

describe("DepositManagerClient.buildRequestDeposit()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
    mockAssembleTransaction.mockReturnValue({ build: mockBuild });
    mockScvBytes.mockClear();
  });

  it("returns assembled XDR string", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    const mockAccount = {
      accountId: () => CONTRACT_ID,
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    };
    const xdrResult = await client.buildRequestDeposit(
      "GABCDE" + "X".repeat(50),
      10_000_000n,
      mockAccount as unknown as Account,
    );
    expect(typeof xdrResult).toBe("string");
    expect(mockContractCall).toHaveBeenCalledWith(
      "request_deposit",
      expect.anything(),
      expect.anything(),
    );
  });

  it("throws when simulation errors", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "auth error" });

    const client = new DepositManagerClient(CONTRACT_ID);
    const mockAccount = {
      accountId: () => CONTRACT_ID,
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    };
    await expect(
      client.buildRequestDeposit(
        "GABCDE" + "X".repeat(50),
        10_000_000n,
        mockAccount as unknown as Account,
      ),
    ).rejects.toThrow("simulation error");
  });
});

describe("DepositManagerClient.buildClaimRequest()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
    mockAssembleTransaction.mockReturnValue({ build: mockBuild });
  });

  it("throws when verifier signature is not 64 bytes", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    const mockAccount = {
      accountId: () => CONTRACT_ID,
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    };
    await expect(
      client.buildClaimRequest(
        1n,
        new Uint8Array(32), // wrong length
        mockAccount as unknown as Account,
      ),
    ).rejects.toThrow("64 bytes");
  });

  it("returns assembled XDR for a valid 64-byte signature", async () => {
    const client = new DepositManagerClient(CONTRACT_ID);
    const mockAccount = {
      accountId: () => CONTRACT_ID,
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    };
    const xdrResult = await client.buildClaimRequest(
      1n,
      new Uint8Array(64).fill(0x01),
      mockAccount as unknown as Account,
    );
    expect(typeof xdrResult).toBe("string");
  });

  it("does not require a global Buffer when building claim bytes", async () => {
    const originalBuffer = Reflect.get(globalThis, "Buffer");
    vi.stubGlobal("Buffer", undefined);

    try {
      const client = new DepositManagerClient(CONTRACT_ID);
      const mockAccount = {
        accountId: () => CONTRACT_ID,
        sequenceNumber: () => "1",
        incrementSequenceNumber: () => {},
      };

      await expect(
        client.buildClaimRequest(
          1n,
          new Uint8Array(64).fill(0x02),
          mockAccount as unknown as Account,
        ),
      ).resolves.toBe("assembled-xdr");

      expect(mockScvBytes).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect((mockScvBytes.mock.calls.at(-1)?.[0] as Uint8Array).length).toBe(
        64,
      );
    } finally {
      vi.unstubAllGlobals();
      if (originalBuffer !== undefined) {
        Reflect.set(globalThis, "Buffer", originalBuffer);
      }
    }
  });
});

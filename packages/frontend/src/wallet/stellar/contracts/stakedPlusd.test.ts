/**
 * Unit tests for `StakedPlusdClient` and `createStakedPlusdClient`.
 *
 * All Soroban RPC calls are mocked — no real network access.
 *
 * Interface notes (from live testnet WASM, 2026-06-18):
 *   - `deposit(assets, receiver, from, operator) → shares` — 4 args, not 2.
 *   - `redeem(shares, receiver, owner, operator) → assets` — 4 args, not 3.
 *   - `query_asset()` (NOT `asset()`) returns the underlying PLUSD SAC ID.
 *   - `balance(account)` returns LP's sPLUSD shares (vault IS the share token).
 *   - No `paused()` view exposed.
 *
 * Scenarios:
 *   1. createStakedPlusdClient — returns null for empty contractId.
 *   2. createStakedPlusdClient — returns client for non-empty contractId.
 *   3. StakedPlusdClient constructor — throws for empty contractId.
 *   4. queryAsset() — decodes mocked simulation result.
 *   5. balance() — decodes i128 result.
 *   6. convertToAssets() — decodes i128, verifies 7-decimal scale input.
 *   7. convertToShares() — decodes i128, verifies 7-decimal scale input.
 *   8. totalSupply() — decodes i128 result.
 *   9. totalAssets() — decodes i128 result.
 *  10. name() — decodes string result.
 *  11. buildDeposit — returns assembled XDR; throws on simulation error.
 *  12. buildRedeem — returns assembled XDR; throws on simulation error.
 *  13. buildWithdraw — returns assembled XDR; throws on simulation error.
 *  14. Simulation error path — throws with descriptive message.
 *  15. No result path — throws "no result".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StakedPlusdClient, createStakedPlusdClient } from "./stakedPlusd";
import type { Account } from "@stellar/stellar-sdk";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockSimulateTransaction,
  mockAssembleTransaction,
  mockIsSimulationError,
  mockScValToNative,
  mockNativeToScVal,
  mockContractCall,
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
        scvBytes: vi.fn().mockReturnValue({}),
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

const CONTRACT_ID = "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5";
const PLUSD_CONTRACT_ID =
  "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN";
const SENDER =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockResult(retval: unknown) {
  return { result: { retval } };
}

function makeMockAccount(): Account {
  return {
    accountId: () => SENDER,
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  } as unknown as Account;
}

// ── Tests: createStakedPlusdClient ────────────────────────────────────────────

describe("createStakedPlusdClient", () => {
  it("returns null for empty contractId", () => {
    expect(createStakedPlusdClient("")).toBeNull();
  });

  it("returns a StakedPlusdClient for a non-empty contractId", () => {
    const client = createStakedPlusdClient(CONTRACT_ID);
    expect(client).toBeInstanceOf(StakedPlusdClient);
  });
});

// ── Tests: constructor ────────────────────────────────────────────────────────

describe("StakedPlusdClient constructor", () => {
  it("throws for empty contractId", () => {
    expect(() => new StakedPlusdClient("")).toThrow(
      "VITE_STELLAR_STAKED_PLUSD_ID",
    );
  });
});

// ── Tests: queryAsset() ───────────────────────────────────────────────────────

describe("StakedPlusdClient.queryAsset()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(PLUSD_CONTRACT_ID);
  });

  it("returns the PLUSD contract ID from simulation result", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const result = await client.queryAsset();
    expect(result).toBe(PLUSD_CONTRACT_ID);
    expect(mockContractCall).toHaveBeenCalledWith("query_asset");
  });

  it("uses query_asset (NOT asset) method name", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    await client.queryAsset();
    expect(mockContractCall).not.toHaveBeenCalledWith("asset");
    expect(mockContractCall).toHaveBeenCalledWith("query_asset");
  });
});

// ── Tests: balance() ─────────────────────────────────────────────────────────

describe("StakedPlusdClient.balance()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(10_000_000n);
  });

  it("returns sPLUSD balance as bigint", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const result = await client.balance(SENDER);
    expect(result).toBe(10_000_000n);
    expect(mockContractCall).toHaveBeenCalledWith("balance", expect.anything());
  });
});

// ── Tests: convertToAssets() ──────────────────────────────────────────────────

describe("StakedPlusdClient.convertToAssets()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(10_400_000n);
  });

  it("returns PLUSD amount as bigint", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const result = await client.convertToAssets(10_000_000n);
    expect(result).toBe(10_400_000n);
    expect(mockContractCall).toHaveBeenCalledWith(
      "convert_to_assets",
      expect.anything(),
    );
  });

  it("uses i128 encoding for the input (7-decimal SAC scale)", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    await client.convertToAssets(10_000_000n); // 1 sPLUSD at 7 decimals
    expect(mockNativeToScVal).toHaveBeenCalledWith(10_000_000n, {
      type: "i128",
    });
  });
});

// ── Tests: convertToShares() ──────────────────────────────────────────────────

describe("StakedPlusdClient.convertToShares()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(9_600_000n);
  });

  it("returns sPLUSD shares as bigint", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const result = await client.convertToShares(10_000_000n);
    expect(result).toBe(9_600_000n);
    expect(mockContractCall).toHaveBeenCalledWith(
      "convert_to_shares",
      expect.anything(),
    );
  });

  it("uses i128 encoding for the input (7-decimal SAC scale)", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    await client.convertToShares(10_000_000n); // 1 PLUSD at 7 decimals
    expect(mockNativeToScVal).toHaveBeenCalledWith(10_000_000n, {
      type: "i128",
    });
  });
});

// ── Tests: totalSupply() ──────────────────────────────────────────────────────

describe("StakedPlusdClient.totalSupply()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(1_000_000_000n);
  });

  it("returns total supply as bigint", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const result = await client.totalSupply();
    expect(result).toBe(1_000_000_000n);
    expect(mockContractCall).toHaveBeenCalledWith("total_supply");
  });
});

// ── Tests: totalAssets() ──────────────────────────────────────────────────────

describe("StakedPlusdClient.totalAssets()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(1_040_000_000n);
  });

  it("returns total assets as bigint", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const result = await client.totalAssets();
    expect(result).toBe(1_040_000_000n);
    expect(mockContractCall).toHaveBeenCalledWith("total_assets");
  });
});

// ── Tests: name() ─────────────────────────────────────────────────────────────

describe("StakedPlusdClient.name()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(makeMockResult("retval-scval"));
    mockScValToNative.mockReturnValue(
      "sPLUSD:GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
    );
  });

  it("returns the share token name string", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const result = await client.name();
    expect(result).toBe(
      "sPLUSD:GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
    );
    expect(mockContractCall).toHaveBeenCalledWith("name");
  });
});

// ── Tests: simulation error ───────────────────────────────────────────────────

describe("StakedPlusdClient — simulation error", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "contract error" });
  });

  it("throws when simulation returns an error", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    await expect(client.queryAsset()).rejects.toThrow("simulation error");
  });
});

// ── Tests: no result ──────────────────────────────────────────────────────────

describe("StakedPlusdClient — no result", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({ result: undefined });
  });

  it("throws when simulation returns no result", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    await expect(client.queryAsset()).rejects.toThrow("no result");
  });
});

// ── Tests: buildDeposit ───────────────────────────────────────────────────────

describe("StakedPlusdClient.buildDeposit()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
    mockAssembleTransaction.mockReturnValue({ build: mockBuild });
  });

  it("returns assembled XDR string", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const xdrResult = await client.buildDeposit(
      SENDER,
      10_000_000n,
      SENDER,
      makeMockAccount(),
    );
    expect(typeof xdrResult).toBe("string");
    // deposit(assets, receiver, from, operator) — 4 args
    expect(mockContractCall).toHaveBeenCalledWith(
      "deposit",
      expect.anything(), // assets i128
      expect.anything(), // receiver
      expect.anything(), // from = sender
      expect.anything(), // operator = sender
    );
  });

  it("throws when simulation errors", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "auth error" });

    const client = new StakedPlusdClient(CONTRACT_ID);
    await expect(
      client.buildDeposit(SENDER, 10_000_000n, SENDER, makeMockAccount()),
    ).rejects.toThrow("simulation error");
  });
});

// ── Tests: buildRedeem ────────────────────────────────────────────────────────

describe("StakedPlusdClient.buildRedeem()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
    mockAssembleTransaction.mockReturnValue({ build: mockBuild });
  });

  it("returns assembled XDR string", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const xdrResult = await client.buildRedeem(
      SENDER,
      9_600_000n,
      SENDER,
      makeMockAccount(),
    );
    expect(typeof xdrResult).toBe("string");
    // redeem(shares, receiver, owner, operator) — 4 args
    expect(mockContractCall).toHaveBeenCalledWith(
      "redeem",
      expect.anything(), // shares i128
      expect.anything(), // receiver
      expect.anything(), // owner = sender
      expect.anything(), // operator = sender
    );
  });

  it("throws when simulation errors", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "auth error" });

    const client = new StakedPlusdClient(CONTRACT_ID);
    await expect(
      client.buildRedeem(SENDER, 9_600_000n, SENDER, makeMockAccount()),
    ).rejects.toThrow("simulation error");
  });
});

// ── Tests: buildWithdraw ──────────────────────────────────────────────────────

describe("StakedPlusdClient.buildWithdraw()", () => {
  beforeEach(() => {
    mockIsSimulationError.mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
    mockAssembleTransaction.mockReturnValue({ build: mockBuild });
  });

  it("returns assembled XDR string", async () => {
    const client = new StakedPlusdClient(CONTRACT_ID);
    const xdrResult = await client.buildWithdraw(
      SENDER,
      10_000_000n,
      SENDER,
      makeMockAccount(),
    );
    expect(typeof xdrResult).toBe("string");
    expect(mockContractCall).toHaveBeenCalledWith(
      "withdraw",
      expect.anything(), // assets i128
      expect.anything(), // receiver
      expect.anything(), // owner = sender
      expect.anything(), // operator = sender
    );
  });

  it("throws when simulation errors", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "auth error" });

    const client = new StakedPlusdClient(CONTRACT_ID);
    await expect(
      client.buildWithdraw(SENDER, 10_000_000n, SENDER, makeMockAccount()),
    ).rejects.toThrow("simulation error");
  });
});

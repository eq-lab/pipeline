/**
 * Unit tests for the `draw_loan` on-chain mint client (issue #831).
 *
 * `@stellar/stellar-sdk` is fully mocked (no real network access) with
 * lightweight tagged-object stand-ins for each `xdr.ScVal` constructor
 * (`{ t: <kind>, v: <value> }`), so encoding assertions can do plain deep
 * equality on the exact shape/scale/order produced — mirroring the mocking
 * style of `sacBalance.test.ts` / `depositManager.test.ts`.
 *
 * Scenarios:
 *   1. `parseUsdcAmountToU128` — the 6-decimal-string → u128 (×1000, floor)
 *      transform, including the invalid-input guard.
 *   2. `encodeDrawLoanArgs` — the 5 positional args, each field's ScVal kind
 *      and scale, and both maps' sorted key order.
 *   3. `drawLoan` — happy path (build → sign → send → poll, stage
 *      callbacks fire in order); no signature requested on a simulation
 *      error; `sendTransaction` `ERROR`; poll non-`SUCCESS`; empty id guards
 *      fire before any RPC call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  drawLoan,
  buildDrawLoanEnvelope,
  encodeDrawLoanArgs,
  parseUsdcAmountToU128,
  encodeRolloverArgs,
  buildRolloverEnvelope,
  encodeUpdateMutableArgs,
  buildUpdateMutableEnvelope,
  type SubmitLoanRequest,
} from "./loanRegistry";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockContractCall,
  mockGetAccount,
  mockSimulateTransaction,
  mockSendTransaction,
  mockPollTransaction,
  mockIsSimulationError,
  mockAssembleTransaction,
  mockFromXDR,
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
    mockContractCall: vi.fn().mockReturnValue("op"),
    mockGetAccount: vi.fn(),
    mockSimulateTransaction: vi.fn(),
    mockSendTransaction: vi.fn(),
    mockPollTransaction: vi.fn(),
    mockIsSimulationError: vi.fn().mockReturnValue(false),
    mockAssembleTransaction: vi.fn().mockReturnValue({ build: mockBuild }),
    mockFromXDR: vi.fn().mockReturnValue("signed-tx"),
    mockAddOperation,
  };
});

vi.mock("@stellar/stellar-sdk", () => {
  class MockContract {
    call(method: string, ...args: unknown[]) {
      return mockContractCall(method, ...args);
    }
  }
  class MockServer {
    getAccount(...args: unknown[]) {
      return mockGetAccount(...args);
    }
    simulateTransaction(...args: unknown[]) {
      return mockSimulateTransaction(...args);
    }
    sendTransaction(...args: unknown[]) {
      return mockSendTransaction(...args);
    }
    pollTransaction(...args: unknown[]) {
      return mockPollTransaction(...args);
    }
  }
  class MockTransactionBuilder {
    constructor(
      public _account: unknown,
      public _opts: unknown,
    ) {}
    addOperation(op: unknown) {
      return mockAddOperation(op);
    }
    static fromXDR(...args: unknown[]) {
      return mockFromXDR(...args);
    }
  }
  class MockAddress {
    constructor(public addr: string) {}
    toScVal() {
      return { t: "address", v: this.addr };
    }
  }

  return {
    Contract: MockContract,
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: "100",
    Address: MockAddress,
    nativeToScVal: vi.fn((value: unknown, opts?: { type?: string }) => ({
      t: opts?.type,
      v: value,
    })),
    xdr: {
      ScVal: {
        scvString: (v: string) => ({ t: "string", v }),
        scvU32: (v: number) => ({ t: "u32", v }),
        scvSymbol: (v: string) => ({ t: "symbol", v }),
        scvVec: (v: unknown[]) => ({ t: "vec", v }),
        scvMap: (v: unknown[]) => ({ t: "map", v }),
      },
      ScMapEntry: class {
        key: unknown;
        val: unknown;
        constructor({ key, val }: { key: unknown; val: unknown }) {
          this.key = key;
          this.val = val;
        }
      },
    },
    rpc: {
      Server: MockServer,
      Api: {
        isSimulationError: mockIsSimulationError,
        GetTransactionStatus: { SUCCESS: "SUCCESS" },
      },
      assembleTransaction: mockAssembleTransaction,
    },
  };
});

// ── Constants ─────────────────────────────────────────────────────────────────

const EXECUTOR_ID = "CAGCWDZYWDN6USS3YY7BA2FGRCLOPGHBTSPJ6VRSPAJSMGFPONFIAREF";
const TARGET_ID = "CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH";
const CALLER = "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU";
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";

const LOAN_DATA: SubmitLoanRequest = {
  to: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  metadata_uri: "ipfs://loan-metadata",
  economics: {
    original_facility_size: "1200000.000000",
    original_senior_tranche: "1000000.000000",
    original_equity_tranche: "200000.000000",
    original_offtaker_price: "1250000.000000",
    senior_interest_rate_bps: 1000,
    origination_date: 1_750_000_000,
    original_maturity_date: 1_780_000_000,
  },
  initial_ccr: 1_500_000,
  initial_location: {
    location_type: "Vessel",
    location_identifier: "IMO-1234567",
    tracking_url: "https://track.example/1234567",
    updated_at: 1_750_000_100,
  },
};

function makeSimResult() {
  return { result: { retval: "retval" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSimulationError.mockReturnValue(false);
  mockGetAccount.mockResolvedValue({ accountId: () => CALLER });
  mockSimulateTransaction.mockResolvedValue(makeSimResult());
  mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "tx-hash" });
  mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
});

// ── parseUsdcAmountToU128 ──────────────────────────────────────────────────────

describe("parseUsdcAmountToU128", () => {
  it("scales a 6-decimal human-unit string by x1000", () => {
    expect(parseUsdcAmountToU128("1200000.000000")).toBe(1_200_000_000n);
  });

  it("handles an integer string with no decimal point", () => {
    expect(parseUsdcAmountToU128("500")).toBe(500_000n);
  });

  it("floors precision beyond 3 decimal places", () => {
    // 100.999999 * 1000 = 100999.999 -> floor -> 100999
    expect(parseUsdcAmountToU128("100.999999")).toBe(100_999n);
  });

  it("pads short fractional parts", () => {
    // 0.5 * 1000 = 500
    expect(parseUsdcAmountToU128("0.5")).toBe(500n);
  });

  it("throws for a malformed decimal string", () => {
    expect(() => parseUsdcAmountToU128("not-a-number")).toThrow(
      "invalid decimal string",
    );
  });

  it("throws for a negative string", () => {
    expect(() => parseUsdcAmountToU128("-5.00")).toThrow(
      "invalid decimal string",
    );
  });
});

// ── encodeDrawLoanArgs ─────────────────────────────────────────────────────────

describe("encodeDrawLoanArgs", () => {
  it("encodes the 5 positional args with the correct ScVal kinds", () => {
    const args = encodeDrawLoanArgs(LOAN_DATA);

    expect(args).toHaveLength(5);
    expect(args[0]).toEqual({ t: "address", v: LOAN_DATA.to });
    expect(args[1]).toEqual({ t: "string", v: LOAN_DATA.metadata_uri });
    expect(args[2]).toMatchObject({ t: "map" });
    expect(args[3]).toEqual({ t: "u32", v: LOAN_DATA.initial_ccr });
    expect(args[4]).toMatchObject({ t: "map" });
  });

  it("encodes the economics map with keys in sorted order", () => {
    const [, , economicsMap] = encodeDrawLoanArgs(LOAN_DATA) as [
      unknown,
      unknown,
      { v: Array<{ key: { v: string }; val: unknown }> },
    ];
    const keys = economicsMap.v.map((entry) => entry.key.v);
    expect(keys).toEqual([
      "original_equity_tranche",
      "original_facility_size",
      "original_maturity_date",
      "original_offtaker_price",
      "original_senior_tranche",
      "origination_date",
      "senior_interest_rate",
    ]);
  });

  it("scales the four USDC amounts by x1000 as u128", () => {
    const [, , economicsMap] = encodeDrawLoanArgs(LOAN_DATA) as [
      unknown,
      unknown,
      {
        v: Array<{ key: { v: string }; val: { t: string; v: bigint } }>;
      },
    ];
    const byKey = Object.fromEntries(
      economicsMap.v.map((e) => [e.key.v, e.val]),
    );
    expect(byKey.original_facility_size).toEqual({
      t: "u128",
      v: 1_200_000_000n,
    });
    expect(byKey.original_senior_tranche).toEqual({
      t: "u128",
      v: 1_000_000_000n,
    });
    expect(byKey.original_equity_tranche).toEqual({
      t: "u128",
      v: 200_000_000n,
    });
    expect(byKey.original_offtaker_price).toEqual({
      t: "u128",
      v: 1_250_000_000n,
    });
  });

  it("scales senior_interest_rate_bps x100 into a u32", () => {
    const [, , economicsMap] = encodeDrawLoanArgs(LOAN_DATA) as [
      unknown,
      unknown,
      { v: Array<{ key: { v: string }; val: { t: string; v: number } }> },
    ];
    const byKey = Object.fromEntries(
      economicsMap.v.map((e) => [e.key.v, e.val]),
    );
    expect(byKey.senior_interest_rate).toEqual({ t: "u32", v: 100_000 });
  });

  it("passes dates through as u64", () => {
    const [, , economicsMap] = encodeDrawLoanArgs(LOAN_DATA) as [
      unknown,
      unknown,
      { v: Array<{ key: { v: string }; val: { t: string; v: bigint } }> },
    ];
    const byKey = Object.fromEntries(
      economicsMap.v.map((e) => [e.key.v, e.val]),
    );
    expect(byKey.origination_date).toEqual({
      t: "u64",
      v: BigInt(LOAN_DATA.economics.origination_date),
    });
    expect(byKey.original_maturity_date).toEqual({
      t: "u64",
      v: BigInt(LOAN_DATA.economics.original_maturity_date),
    });
  });

  it("encodes the location map with keys in sorted order", () => {
    const [, , , , locationMap] = encodeDrawLoanArgs(LOAN_DATA) as [
      unknown,
      unknown,
      unknown,
      unknown,
      { v: Array<{ key: { v: string }; val: unknown }> },
    ];
    const keys = locationMap.v.map((entry) => entry.key.v);
    expect(keys).toEqual([
      "location_identifier",
      "location_type",
      "tracking_url",
      "updated_at",
    ]);
  });

  it("encodes location_type as a unit-variant enum ({vec:[{symbol}]})", () => {
    const [, , , , locationMap] = encodeDrawLoanArgs(LOAN_DATA) as [
      unknown,
      unknown,
      unknown,
      unknown,
      { v: Array<{ key: { v: string }; val: { t: string; v: unknown[] } }> },
    ];
    const byKey = Object.fromEntries(
      locationMap.v.map((e) => [e.key.v, e.val]),
    );
    expect(byKey.location_type).toEqual({
      t: "vec",
      v: [{ t: "symbol", v: "Vessel" }],
    });
  });

  it("passes location_identifier, tracking_url as strings and updated_at as u64", () => {
    const [, , , , locationMap] = encodeDrawLoanArgs(LOAN_DATA) as [
      unknown,
      unknown,
      unknown,
      unknown,
      {
        v: Array<{
          key: { v: string };
          val: { t: string; v: string | bigint };
        }>;
      },
    ];
    const byKey = Object.fromEntries(
      locationMap.v.map((e) => [e.key.v, e.val]),
    );
    expect(byKey.location_identifier).toEqual({
      t: "string",
      v: "IMO-1234567",
    });
    expect(byKey.tracking_url).toEqual({
      t: "string",
      v: "https://track.example/1234567",
    });
    expect(byKey.updated_at).toEqual({
      t: "u64",
      v: BigInt(LOAN_DATA.initial_location.updated_at),
    });
  });
});

// ── buildDrawLoanEnvelope ──────────────────────────────────────────────────────

describe("buildDrawLoanEnvelope", () => {
  function args(overrides: Record<string, unknown> = {}) {
    return {
      executorId: EXECUTOR_ID,
      targetId: TARGET_ID,
      caller: CALLER,
      loanData: LOAN_DATA,
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
      ...overrides,
    };
  }

  it("calls execute with (target, draw_loan symbol, args vec, caller)", async () => {
    await buildDrawLoanEnvelope(args());

    expect(mockContractCall).toHaveBeenCalledWith(
      "execute",
      { t: "address", v: TARGET_ID },
      { t: "symbol", v: "draw_loan" },
      expect.objectContaining({ t: "vec" }),
      { t: "address", v: CALLER },
    );
  });

  it("returns the assembled XDR on a successful simulation", async () => {
    const result = await buildDrawLoanEnvelope(args());
    expect(result).toBe("assembled-xdr");
  });

  it("throws a simulation error without assembling", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "bad encoding" });

    await expect(buildDrawLoanEnvelope(args())).rejects.toThrow(
      "drawLoan simulation error",
    );
    expect(mockAssembleTransaction).not.toHaveBeenCalled();
  });

  it("throws for an empty executorId without calling the RPC", async () => {
    await expect(
      buildDrawLoanEnvelope(args({ executorId: "" })),
    ).rejects.toThrow("executorId must not be empty");
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it("throws for an empty targetId without calling the RPC", async () => {
    await expect(buildDrawLoanEnvelope(args({ targetId: "" }))).rejects.toThrow(
      "targetId must not be empty",
    );
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it("throws for an empty caller without calling the RPC", async () => {
    await expect(buildDrawLoanEnvelope(args({ caller: "" }))).rejects.toThrow(
      "caller must not be empty",
    );
    expect(mockGetAccount).not.toHaveBeenCalled();
  });
});

// ── drawLoan orchestration ─────────────────────────────────────────────────────

describe("drawLoan", () => {
  function baseParams(overrides: Record<string, unknown> = {}) {
    return {
      executorId: EXECUTOR_ID,
      targetId: TARGET_ID,
      caller: CALLER,
      loanData: LOAN_DATA,
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
      signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "signed-xdr" }),
      ...overrides,
    };
  }

  it("happy path: build -> sign -> send -> poll, returns the hash", async () => {
    const signTransaction = vi
      .fn()
      .mockResolvedValue({ signedTxXdr: "signed-xdr" });

    const result = await drawLoan(baseParams({ signTransaction }));

    expect(result).toEqual({ hash: "tx-hash" });
    expect(signTransaction).toHaveBeenCalledWith("assembled-xdr", {
      networkPassphrase: PASSPHRASE,
      address: CALLER,
    });
    expect(mockSendTransaction).toHaveBeenCalledWith("signed-tx");
    expect(mockPollTransaction).toHaveBeenCalledWith("tx-hash");
  });

  it("fires stage callbacks in order: awaiting-signature -> submitting -> confirming", async () => {
    const stages: string[] = [];
    await drawLoan(
      baseParams({ onStageChange: (s: string) => stages.push(s) }),
    );

    expect(stages).toEqual(["awaiting-signature", "submitting", "confirming"]);
  });

  it("requests no signature when the simulation fails", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "bad encoding" });
    const signTransaction = vi.fn();

    await expect(drawLoan(baseParams({ signTransaction }))).rejects.toThrow(
      "drawLoan simulation error",
    );
    expect(signTransaction).not.toHaveBeenCalled();
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it("throws when sendTransaction reports status ERROR, without polling", async () => {
    mockSendTransaction.mockResolvedValue({ status: "ERROR", hash: "tx-hash" });

    await expect(drawLoan(baseParams())).rejects.toThrow(
      "sendTransaction failed: status=ERROR",
    );
    expect(mockPollTransaction).not.toHaveBeenCalled();
  });

  it("throws when the poll result is not SUCCESS", async () => {
    mockPollTransaction.mockResolvedValue({ status: "FAILED" });

    await expect(drawLoan(baseParams())).rejects.toThrow(
      "failed with status FAILED",
    );
  });

  it("propagates a wallet-rejected signTransaction without sending", async () => {
    const signTransaction = vi
      .fn()
      .mockRejectedValue(new Error("User declined access"));

    await expect(drawLoan(baseParams({ signTransaction }))).rejects.toThrow(
      "User declined access",
    );
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });
});

// ── encodeRolloverArgs (issue #870) ────────────────────────────────────────────

describe("encodeRolloverArgs", () => {
  it("encodes (loan_id: u32, new_rate: u32 [bps×100], new_maturity: u64)", () => {
    const args = encodeRolloverArgs(4488, 1450, 1_790_000_000);
    expect(args).toHaveLength(3);
    expect(args[0]).toEqual({ t: "u32", v: 4488 });
    // Rate scaled ×100 to the on-chain unit (1450 bps → 145000).
    expect(args[1]).toEqual({ t: "u32", v: 145_000 });
    expect(args[2]).toEqual({ t: "u64", v: 1_790_000_000n });
  });
});

describe("buildRolloverEnvelope", () => {
  function args(overrides: Record<string, unknown> = {}) {
    return {
      executorId: EXECUTOR_ID,
      targetId: TARGET_ID,
      caller: CALLER,
      loanId: 4488,
      newRateBps: 1450,
      newMaturity: 1_790_000_000,
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
      ...overrides,
    };
  }

  it("calls execute with (target, rollover symbol, args vec, caller)", async () => {
    await buildRolloverEnvelope(args());
    expect(mockContractCall).toHaveBeenCalledWith(
      "execute",
      { t: "address", v: TARGET_ID },
      { t: "symbol", v: "rollover" },
      expect.objectContaining({ t: "vec" }),
      { t: "address", v: CALLER },
    );
  });

  it("throws a simulation error without assembling", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "bad encoding" });
    await expect(buildRolloverEnvelope(args())).rejects.toThrow(
      "rollover simulation error",
    );
    expect(mockAssembleTransaction).not.toHaveBeenCalled();
  });

  it("throws for an empty executorId without calling the RPC", async () => {
    await expect(
      buildRolloverEnvelope(args({ executorId: "" })),
    ).rejects.toThrow("executorId must not be empty");
    expect(mockGetAccount).not.toHaveBeenCalled();
  });
});

// ── encodeUpdateMutableArgs (issue #872) ────────────────────────────────────────

const LOCATION_INPUT = {
  location_type: "Vessel",
  location_identifier: "IMO-9741205",
  tracking_url: "https://track.example/9741205",
  updated_at: 1_784_000_000,
};

describe("encodeUpdateMutableArgs", () => {
  it("encodes the contract's arg ORDER: (loan_id:u32, metadata:String, status:enum, ccr:u32 [ONE=1e6], location:LocationUpdate map)", () => {
    const args = encodeUpdateMutableArgs(
      4488,
      "WatchList",
      135,
      LOCATION_INPUT,
      "ipfs://assay",
    );
    expect(args).toHaveLength(5);
    expect(args[0]).toEqual({ t: "u32", v: 4488 });
    // metadata_uri is SECOND, not last (deployed signature). Sending it last put
    // the status enum in the String slot → guest-side TryFromVal panic (#872).
    expect(args[1]).toEqual({ t: "string", v: "ipfs://assay" });
    // Status is a unit-variant enum: vec([symbol]).
    expect(args[2]).toEqual({ t: "vec", v: [{ t: "symbol", v: "WatchList" }] });
    // 135% → ONE=1e6 scale (percent × 10000).
    expect(args[3]).toEqual({ t: "u32", v: 1_350_000 });
    // Location is the same `LocationUpdate` map as draw_loan — NOT a bare string.
    expect(args[4]).toMatchObject({ t: "map" });
    const locationMap = args[4] as unknown as {
      t: "map";
      v: Array<{ key: { v: string }; val: { t: string; v: string | bigint } }>;
    };
    expect(locationMap.v.map((e) => e.key.v)).toEqual([
      "location_identifier",
      "location_type",
      "tracking_url",
      "updated_at",
    ]);
    const byKey = Object.fromEntries(
      locationMap.v.map((e) => [e.key.v, e.val]),
    );
    expect(byKey.location_type).toEqual({
      t: "vec",
      v: [{ t: "symbol", v: "Vessel" }],
    });
    expect(byKey.updated_at).toEqual({ t: "u64", v: 1_784_000_000n });
  });
});

describe("buildUpdateMutableEnvelope", () => {
  function args(overrides: Record<string, unknown> = {}) {
    return {
      executorId: EXECUTOR_ID,
      targetId: TARGET_ID,
      caller: CALLER,
      loanId: 4488,
      status: "Performing",
      ccrPercent: 135,
      location: LOCATION_INPUT,
      metadataUri: "",
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
      ...overrides,
    };
  }

  it("calls execute with (target, update_mutable symbol, args vec, caller)", async () => {
    await buildUpdateMutableEnvelope(args());
    expect(mockContractCall).toHaveBeenCalledWith(
      "execute",
      { t: "address", v: TARGET_ID },
      { t: "symbol", v: "update_mutable" },
      expect.objectContaining({ t: "vec" }),
      { t: "address", v: CALLER },
    );
  });

  it("throws a simulation error without assembling", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "bad encoding" });
    await expect(buildUpdateMutableEnvelope(args())).rejects.toThrow(
      "updateMutable simulation error",
    );
    expect(mockAssembleTransaction).not.toHaveBeenCalled();
  });
});

// spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  drawLoan,
  buildDrawLoanEnvelope,
  encodeDrawLoanArgs,
  encodeRolloverArgs,
  buildRolloverEnvelope,
  encodeUpdateMutableArgs,
  buildUpdateMutableEnvelope,
  encodeRepaymentData,
  readNextRepaymentId,
  readRepaymentData,
  readIsRepaymentReversed,
  encodeCloseLoanArgs,
  buildCloseLoanEnvelope,
  type DrawLoanArgs,
  type RepaymentInput,
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
  class MockAccount {
    constructor(
      public id: string,
      public seq: string,
    ) {}
  }
  class MockAddress {
    constructor(public addr: string) {}
    toScVal() {
      return { t: "address", v: this.addr };
    }
  }

  return {
    Account: MockAccount,
    Contract: MockContract,
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: "100",
    Address: MockAddress,
    nativeToScVal: vi.fn((value: unknown, opts?: { type?: string }) => ({
      t: opts?.type,
      v: value,
    })),
    // Tagged stand-in: our loan-id extractor reads `.__native` off the ScVal.
    scValToNative: vi.fn(
      (v: { __native?: unknown } | undefined) => v?.__native,
    ),
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

const BORROWER_REF =
  "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";

const DRAW_LOAN_ARGS: DrawLoanArgs = {
  metadata_uri: "ipfs://loan-metadata",
  economics: {
    borrower_ref: BORROWER_REF,
    original_facility_size: "12000000000000",
    original_senior_tranche: "10000000000000",
    original_equity_tranche: "2000000000000",
    original_offtaker_price: "12500000000000",
    senior_interest_rate: 100000,
    origination_date: 1_750_000_000,
    original_maturity_date: 1_780_000_000,
  },
};

function withEconomics(
  overrides: Record<string, unknown>,
  base: DrawLoanArgs = DRAW_LOAN_ARGS,
): DrawLoanArgs {
  return {
    ...base,
    economics: { ...base.economics, ...overrides },
  } as DrawLoanArgs;
}

type MapEntries = Array<{ key: { v: string }; val: { t: string; v: unknown } }>;

function economicsOf(args: DrawLoanArgs) {
  const map = encodeDrawLoanArgs(args)[1] as unknown as { v: MapEntries };
  return Object.fromEntries(map.v.map((e) => [e.key.v, e.val])) as Record<
    keyof DrawLoanArgs["economics"],
    MapEntries[number]["val"]
  >;
}

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

// ── encodeDrawLoanArgs ──────────────────────────────────────────────

describe("encodeDrawLoanArgs", () => {
  it("encodes exactly 2 args: metadata_uri string and the economics map", () => {
    const args = encodeDrawLoanArgs(DRAW_LOAN_ARGS);
    expect(args).toHaveLength(2);
    expect(args[0]).toEqual({ t: "string", v: "ipfs://loan-metadata" });
    expect(args[1]).toMatchObject({ t: "map" });
  });

  it("emits the 8 ImmutableLoanData keys sorted, borrower_ref first", () => {
    const map = encodeDrawLoanArgs(DRAW_LOAN_ARGS)[1] as unknown as {
      v: MapEntries;
    };
    expect(map.v.map((e) => e.key.v)).toEqual([
      "borrower_ref",
      "original_equity_tranche",
      "original_facility_size",
      "original_maturity_date",
      "original_offtaker_price",
      "original_senior_tranche",
      "origination_date",
      "senior_interest_rate",
    ]);
  });

  it("encodes borrower_ref as 32 bytes that round-trip to the served hex", () => {
    const ref = economicsOf(DRAW_LOAN_ARGS).borrower_ref;
    expect(ref.t).toBe("bytes");
    const bytes = ref.v as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(32);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    expect(hex).toBe(BORROWER_REF);
  });

  it("accepts an uppercase-hex borrower_ref", () => {
    const args = withEconomics({ borrower_ref: BORROWER_REF.toUpperCase() });
    const bytes = economicsOf(args).borrower_ref.v as Uint8Array;
    expect(bytes[0]).toBe(0xab);
  });

  it("passes the four amounts through as u128 with no re-scaling", () => {
    const e = economicsOf(DRAW_LOAN_ARGS);
    expect(e.original_facility_size).toEqual({
      t: "u128",
      v: 12_000_000_000_000n,
    });
    expect(e.original_senior_tranche).toEqual({
      t: "u128",
      v: 10_000_000_000_000n,
    });
    expect(e.original_equity_tranche).toEqual({
      t: "u128",
      v: 2_000_000_000_000n,
    });
    expect(e.original_offtaker_price).toEqual({
      t: "u128",
      v: 12_500_000_000_000n,
    });
  });

  it("keeps an amount above 2^53 exact", () => {
    const big = "90071992547409930001";
    const e = economicsOf(withEconomics({ original_facility_size: big }));
    expect(e.original_facility_size).toEqual({ t: "u128", v: BigInt(big) });
  });

  it("accepts an amount at exactly u128::MAX", () => {
    const max = (2n ** 128n - 1n).toString();
    const e = economicsOf(withEconomics({ original_offtaker_price: max }));
    expect(e.original_offtaker_price.v).toBe(2n ** 128n - 1n);
  });

  it("passes the rate through as u32 without multiplying", () => {
    expect(economicsOf(DRAW_LOAN_ARGS).senior_interest_rate).toEqual({
      t: "u32",
      v: 100000,
    });
  });

  it("passes dates through as u64", () => {
    const e = economicsOf(DRAW_LOAN_ARGS);
    expect(e.origination_date).toEqual({ t: "u64", v: 1_750_000_000n });
    expect(e.original_maturity_date).toEqual({ t: "u64", v: 1_780_000_000n });
  });

  describe("rejects bad input before encoding", () => {
    const bad: Array<[string, DrawLoanArgs]> = [
      ["borrower_ref empty", withEconomics({ borrower_ref: "" })],
      ["borrower_ref missing", withEconomics({ borrower_ref: undefined })],
      [
        "borrower_ref short",
        withEconomics({ borrower_ref: BORROWER_REF.slice(0, 62) }),
      ],
      [
        "borrower_ref 0x prefix",
        withEconomics({ borrower_ref: `0x${BORROWER_REF}` }),
      ],
      [
        "borrower_ref non-hex",
        withEconomics({ borrower_ref: `zz${BORROWER_REF.slice(2)}` }),
      ],
      [
        "amount fractional",
        withEconomics({ original_facility_size: "1200000.5" }),
      ],
      ["amount negative", withEconomics({ original_senior_tranche: "-5" })],
      [
        "amount above u128::MAX",
        withEconomics({ original_equity_tranche: (2n ** 128n).toString() }),
      ],
      ["amount a number", withEconomics({ original_offtaker_price: 5 })],
      [
        "rate above u32::MAX",
        withEconomics({ senior_interest_rate: 4_294_967_296 }),
      ],
      ["rate non-integer", withEconomics({ senior_interest_rate: 10.5 })],
      ["date negative", withEconomics({ origination_date: -1 })],
      ["date non-integer", withEconomics({ original_maturity_date: 1.5 })],
      ["metadata_uri empty", { ...DRAW_LOAN_ARGS, metadata_uri: "  " }],
    ];
    it.each(bad)("%s", (_name, args) => {
      expect(() => encodeDrawLoanArgs(args)).toThrow(/invalid draw_loan input/);
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
      args: DRAW_LOAN_ARGS,
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

  it("throws on an invalid borrower_ref without any RPC call", async () => {
    await expect(
      buildDrawLoanEnvelope(
        args({ args: withEconomics({ borrower_ref: "abc" }) }),
      ),
    ).rejects.toThrow(/invalid draw_loan input economics.borrower_ref/);
    expect(mockGetAccount).not.toHaveBeenCalled();
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
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
      args: DRAW_LOAN_ARGS,
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

    // No returnValue / meta on this mock → loanId not recoverable (null), but
    // the mint still succeeds and returns the hash.
    expect(result).toEqual({ hash: "tx-hash", loanId: null });
    expect(signTransaction).toHaveBeenCalledWith("assembled-xdr", {
      networkPassphrase: PASSPHRASE,
      address: CALLER,
    });
    expect(mockSendTransaction).toHaveBeenCalledWith("signed-tx");
    expect(mockPollTransaction).toHaveBeenCalledWith("tx-hash");
  });

  it("extracts the drawn loan id from the transaction return value (#876)", async () => {
    mockPollTransaction.mockResolvedValue({
      status: "SUCCESS",
      returnValue: { __native: 42n },
    });

    const result = await drawLoan(baseParams());

    expect(result).toEqual({ hash: "tx-hash", loanId: 42 });
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

// ── encodeRepaymentData / readNextRepaymentId ───────────────────────────────────

const REPAYMENT: RepaymentInput = {
  offtaker_received: "1500000000000",
  senior_principal_repaid: "0",
  senior_interest: "1155000000000",
  equity_distributed: "0",
  mgmt_fee: "120000000000",
  perf_fee: "150000000000",
  oet_alloc: "75000000000",
};

describe("encodeRepaymentData", () => {
  it("encodes a sorted-key map of u128 base-unit values", () => {
    const map = encodeRepaymentData(REPAYMENT) as unknown as {
      t: "map";
      v: Array<{ key: { v: string }; val: { t: string; v: bigint } }>;
    };
    expect(map.t).toBe("map");
    expect(map.v.map((e) => e.key.v)).toEqual([
      "equity_distributed",
      "mgmt_fee",
      "oet_alloc",
      "offtaker_received",
      "perf_fee",
      "senior_interest",
      "senior_principal_repaid",
    ]);
    const byKey = Object.fromEntries(map.v.map((e) => [e.key.v, e.val]));
    expect(byKey.offtaker_received).toEqual({
      t: "u128",
      v: 1_500_000_000_000n,
    });
    expect(byKey.senior_principal_repaid).toEqual({ t: "u128", v: 0n });
  });
});

describe("readNextRepaymentId", () => {
  const params = {
    registryId: TARGET_ID,
    loanId: 4488,
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
  };

  it("simulates mutable_loan_data read-only and returns next_repayment_id", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { __native: { next_repayment_id: 3 } } },
    });
    await expect(readNextRepaymentId(params)).resolves.toBe(3);
    expect(mockContractCall).toHaveBeenCalledWith("mutable_loan_data", {
      t: "u32",
      v: 4488,
    });
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it("accepts a bigint id", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { __native: { next_repayment_id: 0n } } },
    });
    await expect(readNextRepaymentId(params)).resolves.toBe(0);
  });

  it("throws on a simulation error", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({
      error: "HostError: Error(Contract, #1)",
    });
    await expect(readNextRepaymentId(params)).rejects.toThrow(
      "readNextRepaymentId simulation error: HostError: Error(Contract, #1)",
    );
  });

  it("throws when the struct has no next_repayment_id", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { __native: {} } },
    });
    await expect(readNextRepaymentId(params)).rejects.toThrow(
      /next_repayment_id missing/,
    );
  });

  it("guards an empty registry id", async () => {
    await expect(
      readNextRepaymentId({ ...params, registryId: "" }),
    ).rejects.toThrow(/registryId must not be empty/);
  });
});

describe("readRepaymentData", () => {
  const params = {
    registryId: TARGET_ID,
    loanId: 7,
    repaymentId: 1,
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
  };

  it("maps the u128 struct to raw decimal strings", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: {
        retval: {
          __native: {
            oet_alloc: 75000000000n,
            perf_fee: 150000000000n,
            mgmt_fee: 120000000000n,
            equity_distributed: 0n,
            senior_interest: 1155000000000n,
            senior_principal_repaid: 0n,
            offtaker_received: 1500000000000n,
          },
        },
      },
    });
    await expect(readRepaymentData(params)).resolves.toEqual(REPAYMENT);
    expect(mockContractCall).toHaveBeenCalledWith(
      "repayment_data",
      { t: "u32", v: 7 },
      { t: "u32", v: 1 },
    );
  });

  it("throws on a missing field, a simulation error and an empty id", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { __native: {} } },
    });
    await expect(readRepaymentData(params)).rejects.toThrow(
      /offtaker_received missing/,
    );
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "boom" });
    await expect(readRepaymentData(params)).rejects.toThrow(
      "repayment_data simulation error: boom",
    );
    await expect(
      readRepaymentData({ ...params, registryId: "" }),
    ).rejects.toThrow(/registryId must not be empty/);
  });
});

describe("readIsRepaymentReversed", () => {
  const params = {
    registryId: TARGET_ID,
    loanId: 7,
    repaymentId: 1,
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
  };

  it("returns the on-chain boolean", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { __native: true } },
    });
    await expect(readIsRepaymentReversed(params)).resolves.toBe(true);
    expect(mockContractCall).toHaveBeenCalledWith(
      "is_repayment_reversed",
      { t: "u32", v: 7 },
      { t: "u32", v: 1 },
    );
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { __native: false } },
    });
    await expect(readIsRepaymentReversed(params)).resolves.toBe(false);
  });

  it("guards an empty registry id", async () => {
    await expect(
      readIsRepaymentReversed({ ...params, registryId: "" }),
    ).rejects.toThrow(/registryId must not be empty/);
  });
});

// ── encodeCloseLoanArgs / closeLoan (issue #884) ────────────────────────────────

describe("encodeCloseLoanArgs", () => {
  it("encodes [loan_id: u32, reason: ClosureReason enum]", () => {
    const args = encodeCloseLoanArgs(4488, "ScheduledMaturity");
    expect(args).toHaveLength(2);
    expect(args[0]).toEqual({ t: "u32", v: 4488 });
    // ClosureReason is a unit-variant enum: vec([symbol]).
    expect(args[1]).toEqual({
      t: "vec",
      v: [{ t: "symbol", v: "ScheduledMaturity" }],
    });
  });

  it("encodes the EarlyRepayment variant", () => {
    const args = encodeCloseLoanArgs(7, "EarlyRepayment");
    expect(args[1]).toEqual({
      t: "vec",
      v: [{ t: "symbol", v: "EarlyRepayment" }],
    });
  });
});

describe("buildCloseLoanEnvelope", () => {
  function args(overrides: Record<string, unknown> = {}) {
    return {
      executorId: EXECUTOR_ID,
      targetId: TARGET_ID,
      caller: CALLER,
      loanId: 4488,
      reason: "ScheduledMaturity",
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
      ...overrides,
    };
  }

  it("calls execute with (target, close_loan symbol, args vec, caller)", async () => {
    await buildCloseLoanEnvelope(args());
    expect(mockContractCall).toHaveBeenCalledWith(
      "execute",
      { t: "address", v: TARGET_ID },
      { t: "symbol", v: "close_loan" },
      expect.objectContaining({ t: "vec" }),
      { t: "address", v: CALLER },
    );
  });

  it("throws a simulation error without assembling", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "bad encoding" });
    await expect(buildCloseLoanEnvelope(args())).rejects.toThrow(
      "closeLoan simulation error",
    );
    expect(mockAssembleTransaction).not.toHaveBeenCalled();
  });
});

// spec: docs/product-specs/deposits.md#stellar-plusd-mint-leg
import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordWireIn,
  buildRecordWireInEnvelope,
  encodeRecordWireInArgs,
  parseUsdDollarsToI128,
  hexToBytes32ScVal,
  repay,
  buildRepayEnvelope,
  encodeRepayArgs,
  repaymentRefHash,
  type RecordWireInStage,
  type RepayStage,
} from "./minter";

const {
  mockContractCall,
  mockContractCtor,
  mockGetAccount,
  mockSimulateTransaction,
  mockSendTransaction,
  mockPollTransaction,
  mockIsSimulationError,
  mockAssembleTransaction,
  mockFromXDR,
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
    mockContractCtor: vi.fn(),
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
    constructor(id: string) {
      mockContractCtor(id);
    }
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
      return {
        setTimeout: () => ({
          build: () => ({ toXDR: () => "assembled-xdr", _op: op }),
        }),
      };
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
    scValToNative: vi.fn(
      (v: { __native?: unknown } | undefined) => v?.__native,
    ),
    xdr: {
      ScMapEntry: class {
        key: unknown;
        val: unknown;
        constructor({ key, val }: { key: unknown; val: unknown }) {
          this.key = key;
          this.val = val;
        }
      },
      ScVal: {
        scvString: (v: string) => ({ t: "string", v }),
        scvU32: (v: number) => ({ t: "u32", v }),
        scvSymbol: (v: string) => ({ t: "symbol", v }),
        scvVec: (v: unknown[]) => ({ t: "vec", v }),
        scvMap: (v: unknown[]) => ({ t: "map", v }),
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

const MINTER_ID = "CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK";
const CALLER = "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU";
const RECEIVER = "GCGQVOJHXSHDTYXTDLBZTQZAPLUGWOYIQZLHTPOXMPFPLWJ5TSLNVMAQ";
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const REF_HASH =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const ARGS = {
  caller: CALLER,
  receiver: RECEIVER,
  amount: "50000.00",
  valueDate: 1_750_000_000,
  refHash: REF_HASH,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSimulationError.mockReturnValue(false);
  mockGetAccount.mockResolvedValue({ accountId: () => CALLER });
  mockSimulateTransaction.mockResolvedValue({ result: { retval: "retval" } });
  mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "tx-hash" });
  mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
});

describe("parseUsdDollarsToI128", () => {
  it("scales plain dollar strings to 7-decimal base units", () => {
    expect(parseUsdDollarsToI128("50000.00")).toBe(500_000_000_000n);
    expect(parseUsdDollarsToI128("0.01")).toBe(100_000n);
    expect(parseUsdDollarsToI128("1")).toBe(10_000_000n);
    expect(parseUsdDollarsToI128("1234567.8901234")).toBe(12_345_678_901_234n);
  });

  it("trims surrounding whitespace", () => {
    expect(parseUsdDollarsToI128("  12.50  ")).toBe(125_000_000n);
  });

  it("rejects malformed, non-positive, and over-precise amounts", () => {
    expect(() => parseUsdDollarsToI128("")).toThrow(/invalid USD amount/);
    expect(() => parseUsdDollarsToI128("abc")).toThrow(/invalid USD amount/);
    expect(() => parseUsdDollarsToI128("-1")).toThrow(/invalid USD amount/);
    expect(() => parseUsdDollarsToI128("1.")).toThrow(/invalid USD amount/);
    expect(() => parseUsdDollarsToI128("1.12345678")).toThrow(
      /invalid USD amount/,
    );
    expect(() => parseUsdDollarsToI128("0")).toThrow(/greater than zero/);
    expect(() => parseUsdDollarsToI128("0.0000000")).toThrow(
      /greater than zero/,
    );
  });
});

describe("hexToBytes32ScVal", () => {
  it("decodes a 64-char lowercase hex hash to 32 bytes", () => {
    const scVal = hexToBytes32ScVal(REF_HASH) as unknown as {
      t: string;
      v: Uint8Array;
    };
    expect(scVal.t).toBe("bytes");
    expect(scVal.v).toBeInstanceOf(Uint8Array);
    expect(scVal.v.length).toBe(32);
    expect(scVal.v[0]).toBe(0x9f);
    expect(scVal.v[31]).toBe(0x08);
  });

  it("rejects wrong length, uppercase, and non-hex input", () => {
    expect(() => hexToBytes32ScVal("9f86d081")).toThrow(/64 lowercase hex/);
    expect(() => hexToBytes32ScVal(REF_HASH.toUpperCase())).toThrow(
      /64 lowercase hex/,
    );
    expect(() => hexToBytes32ScVal(`${REF_HASH.slice(0, 63)}z`)).toThrow(
      /64 lowercase hex/,
    );
    expect(() => hexToBytes32ScVal("")).toThrow(/64 lowercase hex/);
  });
});

describe("encodeRecordWireInArgs", () => {
  it("emits the five positional args in contract order with exact types", () => {
    const args = encodeRecordWireInArgs(ARGS) as unknown as Array<{
      t: string;
      v: unknown;
    }>;
    expect(args).toHaveLength(5);
    expect(args[0]).toEqual({ t: "address", v: CALLER });
    expect(args[1]).toEqual({ t: "address", v: RECEIVER });
    expect(args[2]).toEqual({ t: "i128", v: 500_000_000_000n });
    expect(args[3]).toEqual({ t: "u64", v: 1_750_000_000n });
    expect(args[4]!.t).toBe("bytes");
    expect((args[4]!.v as Uint8Array).length).toBe(32);
  });

  it("rejects a non-positive or fractional value date", () => {
    expect(() => encodeRecordWireInArgs({ ...ARGS, valueDate: 0 })).toThrow(
      /positive Unix-seconds integer/,
    );
    expect(() => encodeRecordWireInArgs({ ...ARGS, valueDate: 1.5 })).toThrow(
      /positive Unix-seconds integer/,
    );
  });
});

describe("buildRecordWireInEnvelope", () => {
  it("invokes record_wire_in directly on the minter contract", async () => {
    const xdrStr = await buildRecordWireInEnvelope({
      ...ARGS,
      minterId: MINTER_ID,
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
    });

    expect(xdrStr).toBe("assembled-xdr");
    expect(mockContractCtor).toHaveBeenCalledWith(MINTER_ID);
    const [method, ...callArgs] = mockContractCall.mock.calls[0]!;
    expect(method).toBe("record_wire_in");
    expect(callArgs).toHaveLength(5);
    expect(callArgs[0]).toEqual({ t: "address", v: CALLER });
    expect(mockGetAccount).toHaveBeenCalledWith(CALLER);
  });

  it("propagates the contract text on a simulation error", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({
      error: "HostError: Error(Contract, #7)",
    });

    await expect(
      buildRecordWireInEnvelope({
        ...ARGS,
        minterId: MINTER_ID,
        rpcUrl: RPC_URL,
        networkPassphrase: PASSPHRASE,
      }),
    ).rejects.toThrow(
      "recordWireIn simulation error: HostError: Error(Contract, #7)",
    );
  });

  it("guards empty ids before any RPC call", async () => {
    await expect(
      buildRecordWireInEnvelope({
        ...ARGS,
        minterId: "",
        rpcUrl: RPC_URL,
        networkPassphrase: PASSPHRASE,
      }),
    ).rejects.toThrow(/minterId must not be empty/);
    await expect(
      buildRecordWireInEnvelope({
        ...ARGS,
        receiver: "",
        minterId: MINTER_ID,
        rpcUrl: RPC_URL,
        networkPassphrase: PASSPHRASE,
      }),
    ).rejects.toThrow(/receiver must not be empty/);
    expect(mockGetAccount).not.toHaveBeenCalled();
  });
});

describe("recordWireIn", () => {
  function params(overrides: Record<string, unknown> = {}) {
    return {
      ...ARGS,
      minterId: MINTER_ID,
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
      signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "signed" }),
      ...overrides,
    };
  }

  it("runs build → sign → submit → poll and reports the stages in order", async () => {
    const stages: RecordWireInStage[] = [];
    const result = await recordWireIn(
      params({ onStageChange: (s: RecordWireInStage) => stages.push(s) }),
    );

    expect(stages).toEqual(["awaiting-signature", "submitting", "confirming"]);
    expect(result).toEqual({ hash: "tx-hash", wireId: null });
  });

  it("reads the wire id from the transaction return value", async () => {
    mockPollTransaction.mockResolvedValue({
      status: "SUCCESS",
      returnValue: { __native: 42n },
    });

    await expect(recordWireIn(params())).resolves.toEqual({
      hash: "tx-hash",
      wireId: 42,
    });
  });

  it("falls back to the wire_in event topic for the wire id", async () => {
    mockPollTransaction.mockResolvedValue({
      status: "SUCCESS",
      resultMetaXdr: {
        v3: () => ({
          sorobanMeta: () => ({
            events: () => [
              {
                body: () => ({
                  v0: () => ({
                    topics: () => [{ __native: "wire_in" }, { __native: 7 }],
                  }),
                }),
              },
            ],
          }),
        }),
      },
    });

    await expect(recordWireIn(params())).resolves.toEqual({
      hash: "tx-hash",
      wireId: 7,
    });
  });

  it("never requests a signature when the simulation fails", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "boom" });
    const signTransaction = vi.fn();

    await expect(recordWireIn(params({ signTransaction }))).rejects.toThrow(
      /simulation error/,
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("throws when sendTransaction reports ERROR", async () => {
    mockSendTransaction.mockResolvedValue({ status: "ERROR", hash: "bad" });
    await expect(recordWireIn(params())).rejects.toThrow(
      /sendTransaction failed/,
    );
  });

  it("throws when the poll ends in a non-SUCCESS status", async () => {
    mockPollTransaction.mockResolvedValue({ status: "FAILED" });
    await expect(recordWireIn(params())).rejects.toThrow(
      /failed with status FAILED/,
    );
  });
});

const REPAYMENT = {
  offtaker_received: "1500000000000",
  senior_principal_repaid: "0",
  senior_interest: "1155000000000",
  equity_distributed: "0",
  mgmt_fee: "120000000000",
  perf_fee: "150000000000",
  oet_alloc: "75000000000",
};

const REPAY_ARGS = {
  caller: CALLER,
  loanId: 7,
  repayment: REPAYMENT,
  valueDate: 1_793_059_200,
  refHash: REF_HASH,
};

describe("encodeRepayArgs", () => {
  it("emits the six positional args in contract order with exact types", () => {
    const args = encodeRepayArgs(REPAY_ARGS) as unknown as Array<{
      t: string;
      v: unknown;
    }>;
    expect(args).toHaveLength(6);
    expect(args.map((a) => a.t)).toEqual([
      "address",
      "u32",
      "map",
      "u64",
      "bytes",
      "u32",
    ]);
    expect(args[0]).toEqual({ t: "address", v: CALLER });
    expect(args[1]).toEqual({ t: "u32", v: 7 });
    expect(args[3]).toEqual({ t: "u64", v: 1_793_059_200n });
    expect((args[4]!.v as Uint8Array).length).toBe(32);
    expect(args[5]).toEqual({ t: "u32", v: 0 });
  });

  it("encodes the repayment as a sorted-key u128 map", () => {
    const args = encodeRepayArgs(REPAY_ARGS) as unknown as Array<{
      t: string;
      v: Array<{ key: { v: string }; val: { t: string; v: bigint } }>;
    }>;
    const entries = args[2]!.v;
    expect(entries.map((e) => e.key.v)).toEqual([
      "equity_distributed",
      "mgmt_fee",
      "oet_alloc",
      "offtaker_received",
      "perf_fee",
      "senior_interest",
      "senior_principal_repaid",
    ]);
    expect(entries.every((e) => e.val.t === "u128")).toBe(true);
  });

  it("passes an explicit sale id", () => {
    const args = encodeRepayArgs({
      ...REPAY_ARGS,
      saleId: 5,
    }) as unknown as Array<{
      t: string;
      v: unknown;
    }>;
    expect(args[5]).toEqual({ t: "u32", v: 5 });
  });

  it("rejects a non-positive or fractional value date", () => {
    expect(() => encodeRepayArgs({ ...REPAY_ARGS, valueDate: 0 })).toThrow(
      /positive Unix-seconds integer/,
    );
    expect(() => encodeRepayArgs({ ...REPAY_ARGS, valueDate: 1.5 })).toThrow(
      /positive Unix-seconds integer/,
    );
  });

  it("rejects a malformed or zero ref hash", () => {
    expect(() => encodeRepayArgs({ ...REPAY_ARGS, refHash: "9f86" })).toThrow(
      /64 lowercase hex/,
    );
    expect(() =>
      encodeRepayArgs({ ...REPAY_ARGS, refHash: "0".repeat(64) }),
    ).toThrow(/zero hash/);
  });
});

describe("buildRepayEnvelope", () => {
  const base = {
    ...REPAY_ARGS,
    minterId: MINTER_ID,
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
  };

  it("invokes repay on the minter with the caller as source", async () => {
    await expect(buildRepayEnvelope(base)).resolves.toBe("assembled-xdr");
    expect(mockContractCtor).toHaveBeenCalledWith(MINTER_ID);
    const [method, ...callArgs] = mockContractCall.mock.calls[0]!;
    expect(method).toBe("repay");
    expect(callArgs).toHaveLength(6);
    expect(mockGetAccount).toHaveBeenCalledWith(CALLER);
  });

  it("throws repay simulation error on a failed simulation", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({
      error: "HostError: Error(Contract, #4)",
    });
    await expect(buildRepayEnvelope(base)).rejects.toThrow(
      "repay simulation error: HostError: Error(Contract, #4)",
    );
  });

  it("guards empty minter and caller before any RPC call", async () => {
    await expect(buildRepayEnvelope({ ...base, minterId: "" })).rejects.toThrow(
      /minterId must not be empty/,
    );
    await expect(buildRepayEnvelope({ ...base, caller: "" })).rejects.toThrow(
      /caller must not be empty/,
    );
    expect(mockGetAccount).not.toHaveBeenCalled();
  });
});

describe("repay", () => {
  function params(overrides: Record<string, unknown> = {}) {
    return {
      ...REPAY_ARGS,
      minterId: MINTER_ID,
      rpcUrl: RPC_URL,
      networkPassphrase: PASSPHRASE,
      signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "signed" }),
      ...overrides,
    };
  }

  it("runs build, sign, submit, poll and reports the stages in order", async () => {
    const stages: RepayStage[] = [];
    const result = await repay(
      params({ onStageChange: (s: RepayStage) => stages.push(s) }),
    );
    expect(stages).toEqual(["awaiting-signature", "submitting", "confirming"]);
    expect(result).toEqual({ hash: "tx-hash", repaymentId: null });
  });

  it("reads the repayment id (including 0) from the return value", async () => {
    mockPollTransaction.mockResolvedValue({
      status: "SUCCESS",
      returnValue: { __native: 0 },
    });
    await expect(repay(params())).resolves.toEqual({
      hash: "tx-hash",
      repaymentId: 0,
    });
  });

  it("falls back to the cash_repaid event data for the repayment id", async () => {
    mockPollTransaction.mockResolvedValue({
      status: "SUCCESS",
      resultMetaXdr: {
        v3: () => ({
          sorobanMeta: () => ({
            events: () => [
              {
                body: () => ({
                  v0: () => ({
                    topics: () => [
                      { __native: "cash_repaid" },
                      { __native: 7 },
                    ],
                    data: () => ({ __native: { repayment_id: 4n } }),
                  }),
                }),
              },
            ],
          }),
        }),
      },
    });
    await expect(repay(params())).resolves.toEqual({
      hash: "tx-hash",
      repaymentId: 4,
    });
  });

  it("never requests a signature when the simulation fails", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "boom" });
    const signTransaction = vi.fn();
    await expect(repay(params({ signTransaction }))).rejects.toThrow(
      /simulation error/,
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("throws when sendTransaction reports ERROR", async () => {
    mockSendTransaction.mockResolvedValue({ status: "ERROR", hash: "bad" });
    await expect(repay(params())).rejects.toThrow(/sendTransaction failed/);
  });

  it("throws when the poll ends in a non-SUCCESS status", async () => {
    mockPollTransaction.mockResolvedValue({ status: "FAILED" });
    await expect(repay(params())).rejects.toThrow(/failed with status FAILED/);
  });
});

describe("repaymentRefHash", () => {
  const base = { registryId: "CREG", loanId: 7, nextRepaymentId: 0 };

  it("is the sha256 of the pinned preimage as 64 lowercase hex", async () => {
    const hash = await repaymentRefHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHash("sha256")
      .update("pipeline:repay:CREG:7:0")
      .digest("hex");
    expect(hash).toBe(expected);
  });

  it("is deterministic and changes with each input", async () => {
    const a = await repaymentRefHash(base);
    expect(await repaymentRefHash(base)).toBe(a);
    expect(await repaymentRefHash({ ...base, registryId: "CREG2" })).not.toBe(
      a,
    );
    expect(await repaymentRefHash({ ...base, loanId: 8 })).not.toBe(a);
    expect(await repaymentRefHash({ ...base, nextRepaymentId: 1 })).not.toBe(a);
  });
});

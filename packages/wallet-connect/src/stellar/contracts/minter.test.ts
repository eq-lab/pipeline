// spec: docs/product-specs/deposits.md#stellar-plusd-mint-leg
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordWireIn,
  buildRecordWireInEnvelope,
  encodeRecordWireInArgs,
  parseUsdDollarsToI128,
  hexToBytes32ScVal,
  type RecordWireInStage,
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

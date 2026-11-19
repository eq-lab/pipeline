// spec: docs/product-specs/loan-repayment-recovery.md
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  concatHex,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionResult,
  encodeEventTopics,
  getAddress,
  hexToBigInt,
  keccak256,
  pad,
  toFunctionSelector,
  toHex,
  type Hex,
} from "viem";
import { createHash } from "node:crypto";

const { mockRead, mockScan, mockHead, mockRelay, mockSchedule, mockSend } =
  vi.hoisted(() => ({
    mockRead: vi.fn(),
    mockScan: vi.fn(),
    mockHead: vi.fn(),
    mockRelay: vi.fn(),
    mockSchedule: vi.fn(),
    mockSend: vi.fn(),
  }));

vi.mock("./write", async () => {
  const actual = await vi.importActual<typeof import("./write")>("./write");
  return {
    readEvmContract: mockRead,
    sendEvmContractCall: mockSend,
    sendEvmContractCallChecked: (
      label: string,
      params: Parameters<typeof actual.sendEvmContractCallChecked>[1],
    ) => actual.sendEvmContractCallChecked(label, params, mockSend),
  };
});
vi.mock("./accessManager", async () => {
  const actual =
    await vi.importActual<typeof import("./accessManager")>("./accessManager");
  return {
    accessManagerAbi: actual.accessManagerAbi,
    relayEvm: mockRelay,
    readEvmOperationSchedule: mockSchedule,
  };
});
vi.mock("./logs", async () => {
  const actual = await vi.importActual<typeof import("./logs")>("./logs");
  return { ...actual, scanEvmLogs: mockScan, readEvmHeadBlock: mockHead };
});

import {
  EVM_RECOVERY_EVENT_TOPICS,
  MINTER_REPAYMENTS_FIELD,
  MINTER_STORAGE_SLOT,
  encodeEvmRepayCalldata,
  encodeEvmReverseRepayCalldata,
  evmMinterErrorAbi,
  evmMinterRepaymentSlot,
  evmRecoveryErrorAbi,
  evmRepaySelector,
  evmReverseRepayRefHash,
  evmReverseRepaySelector,
  executeEvmReverseRepay,
  minterExtsloadAbi,
  minterRecoveryAbi,
  minterRepaymentViewAbi,
  readEvmMinterRepayment,
  readEvmNextRepaymentId,
  MINTER_BANK_CASH_FIELD,
  MINTER_REF_HASHES_SEEN_FIELD,
  disburseEvmLoan,
  encodeEvmDisburseCalldata,
  evmDisburseErrorAbi,
  evmDisburseSelector,
  evmRepayErrorAbi,
  evmRepaymentRefHash,
  minterDisburseAbi,
  readEvmMinterBankCash,
  readEvmMinterPaused,
  readEvmRefHashSeen,
  readEvmRepaymentId,
  readEvmRecoveryRepayments,
  readEvmReverseRepaySchedule,
  repayEvmLoan,
  scheduleEvmReverseRepay,
} from "./minter";
import { evmLoanRegistryRiskCouncilAbi } from "./riskCouncil";

const HASH = `0x${"ab".repeat(32)}` as const;
const REPAYMENT = {
  offtaker_received: "1500000000000",
  senior_principal_repaid: "10",
  senior_interest: "1155000000000",
  equity_distributed: "20",
  mgmt_fee: "120000000000",
  perf_fee: "150000000000",
  oet_alloc: "75000000000",
};

describe("encodeEvmReverseRepayCalldata", () => {
  it("uses the reverseRepay(uint256,uint256,bytes32) selector", () => {
    const data = encodeEvmReverseRepayCalldata({
      loanId: 7,
      repaymentId: 2,
      refHash: HASH,
    });
    expect(data.slice(0, 10)).toBe(
      toFunctionSelector("reverseRepay(uint256,uint256,bytes32)"),
    );
  });

  it("round-trips every field", () => {
    const data = encodeEvmReverseRepayCalldata({
      loanId: 7,
      repaymentId: 2,
      refHash: HASH,
    });
    const decoded = decodeFunctionData({ abi: minterRecoveryAbi, data });
    expect(decoded.functionName).toBe("reverseRepay");
    expect(decoded.args).toEqual([7n, 2n, HASH]);
  });

  it("rejects the zero hash and malformed hashes", () => {
    const base = { loanId: 7, repaymentId: 2 };
    expect(() =>
      encodeEvmReverseRepayCalldata({
        ...base,
        refHash: `0x${"0".repeat(64)}`,
      }),
    ).toThrow(/zero hash/);
    expect(() =>
      encodeEvmReverseRepayCalldata({ ...base, refHash: "0x1234" }),
    ).toThrow(/64 hex characters/);
    expect(() =>
      encodeEvmReverseRepayCalldata({ ...base, refHash: "ab".repeat(32) }),
    ).toThrow(/64 hex characters/);
  });
});

describe("encodeEvmRepayCalldata", () => {
  const input = {
    loanId: 7,
    repayment: REPAYMENT,
    valueDate: 1_793_059_200,
    refHash: HASH,
  };

  it("uses the repay tuple selector", () => {
    expect(encodeEvmRepayCalldata(input).slice(0, 10)).toBe(
      toFunctionSelector(
        "repay(uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256),uint64,bytes32,uint256)",
      ),
    );
  });

  it("round-trips the tuple in contract order with raw values unchanged", () => {
    const decoded = decodeFunctionData({
      abi: minterRecoveryAbi,
      data: encodeEvmRepayCalldata({ ...input, saleId: 5 }),
    });
    expect(decoded.functionName).toBe("repay");
    expect(decoded.args).toEqual([
      7n,
      {
        offtakerReceived: 1500000000000n,
        seniorPrincipalRepaid: 10n,
        seniorInterest: 1155000000000n,
        equityDistributed: 20n,
        mgmtFee: 120000000000n,
        perfFee: 150000000000n,
        oetAlloc: 75000000000n,
      },
      1_793_059_200n,
      HASH,
      5n,
    ]);
  });

  it("defaults the sale id to 0", () => {
    const decoded = decodeFunctionData({
      abi: minterRecoveryAbi,
      data: encodeEvmRepayCalldata(input),
    });
    expect(decoded.args?.[4]).toBe(0n);
  });

  it("rejects the zero hash and malformed hashes", () => {
    expect(() =>
      encodeEvmRepayCalldata({ ...input, refHash: `0x${"0".repeat(64)}` }),
    ).toThrow(/zero hash/);
    expect(() => encodeEvmRepayCalldata({ ...input, refHash: "0xzz" })).toThrow(
      /64 hex characters/,
    );
  });
});

const MINTER = "0x621baab0ced6b11f88019582183b081a118755f4";
const REGISTRY = "0xdf08fdf0f47272a8ced33a5f913f6c9d179b0231";
const AM = "0x00000000000000000000000000000000000000a1";
const CALLER = "0x00000000000000000000000000000000000000c1";

beforeEach(() => {
  mockRead.mockReset();
  mockScan.mockReset();
  mockHead.mockReset();
  mockRelay.mockReset();
  mockSchedule.mockReset();
});

describe("recovery selectors pinned to contracts 150631a", () => {
  it("reverseRepay and repay", () => {
    expect(evmReverseRepaySelector()).toBe("0x0cff7536");
    expect(evmRepaySelector()).toBe("0x87d2050a");
    expect(evmReverseRepaySelector()).toBe(
      toFunctionSelector("reverseRepay(uint256,uint256,bytes32)"),
    );
  });

  it("extsload", () => {
    expect(toFunctionSelector(minterExtsloadAbi[0])).toBe("0x1e2eaeaf");
  });

  it("recovery event topics", () => {
    expect([...EVM_RECOVERY_EVENT_TOPICS]).toEqual([
      "0x3b3f1fffa04e822b79e28cf10f1842d1d00541af6a6468a51a079da8603c5ecd",
      "0x4be4fba083143bb97036429029f76a6e3c008dcb02dac6f323529d2504960f3c",
      "0xba142cd10c3cbd6cc40c1242c6493913c3288b36a8c57340b4862c2df17ca074",
    ]);
  });
});

describe("error ABIs", () => {
  const names = (abi: readonly { type: string }[]) =>
    abi.map((item) => ("name" in item ? String(item.name) : ""));

  it("carries the Minter errors", () => {
    expect(names(evmMinterErrorAbi)).toEqual(
      expect.arrayContaining([
        "MinterInsufficientBankCash",
        "MinterAlreadyReversed",
        "MinterRefHashSeen",
      ]),
    );
  });

  it("adds the LoanRegistry errors reverseRepay can bubble", () => {
    expect(names(evmRecoveryErrorAbi)).toEqual(
      expect.arrayContaining([
        "MinterInsufficientBankCash",
        "LoanRegistryRepaymentAlreadyReversed",
        "EnforcedPause",
      ]),
    );
  });
});

describe("evmReverseRepayRefHash", () => {
  const sha = (text: string) =>
    `0x${createHash("sha256").update(text).digest("hex")}`;

  it("is 0x plus the sha256 of the Stellar preimage with the EIP-55 address", async () => {
    const hash = await evmReverseRepayRefHash({
      minter: MINTER,
      loanId: 7,
      repaymentId: 2,
    });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hash).toBe(sha(`pipeline:reverse_repay:${getAddress(MINTER)}:7:2`));
  });

  it("is deterministic and ignores the input address case", async () => {
    const a = await evmReverseRepayRefHash({
      minter: MINTER,
      loanId: 7,
      repaymentId: 2,
    });
    const b = await evmReverseRepayRefHash({
      minter: getAddress(MINTER),
      loanId: 7,
      repaymentId: 2,
    });
    expect(a).toBe(b);
  });

  it("differs per repayment and is never the zero hash", async () => {
    const a = await evmReverseRepayRefHash({
      minter: MINTER,
      loanId: 7,
      repaymentId: 2,
    });
    const b = await evmReverseRepayRefHash({
      minter: MINTER,
      loanId: 7,
      repaymentId: 3,
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(`0x${"0".repeat(64)}`);
  });
});

describe("reverse repay relay and schedule", () => {
  const args = {
    accessManager: AM,
    minter: MINTER,
    caller: CALLER,
    loanId: 7,
    repaymentId: 2,
    refHash: HASH,
  };

  it("relays reverseRepay calldata to the Minter with the recovery error ABI", async () => {
    mockRelay.mockResolvedValue({ hash: "0xabc" });
    await scheduleEvmReverseRepay({ ...args, chainId: 560048 });
    await executeEvmReverseRepay({ ...args, chainId: 560048 });
    const data = encodeEvmReverseRepayCalldata({
      loanId: 7,
      repaymentId: 2,
      refHash: HASH,
    });
    expect(mockRelay).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        mode: "schedule",
        target: MINTER,
        data,
        errorAbi: evmRecoveryErrorAbi,
      }),
    );
    expect(mockRelay).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "execute", target: MINTER, data }),
    );
  });

  it("reads the schedule of the same calldata", async () => {
    mockSchedule.mockResolvedValue({ operationId: "aa", readyAt: 9 });
    await expect(readEvmReverseRepaySchedule(args)).resolves.toEqual({
      operationId: "aa",
      readyAt: 9,
    });
    expect(mockSchedule).toHaveBeenCalledWith({
      accessManager: AM,
      caller: CALLER,
      target: MINTER,
      data: encodeEvmReverseRepayCalldata({
        loanId: 7,
        repaymentId: 2,
        refHash: HASH,
      }),
    });
  });
});

describe("Minter storage slot", () => {
  it("equals the ERC-7201 formula for pipeline.storage.Minter", () => {
    const id = hexToBigInt(keccak256(toHex("pipeline.storage.Minter"))) - 1n;
    const slot = hexToBigInt(keccak256(pad(toHex(id), { size: 32 }))) & ~0xffn;
    expect(MINTER_STORAGE_SLOT).toBe(toHex(slot, { size: 32 }));
    expect(MINTER_REPAYMENTS_FIELD).toBe(19n);
  });

  it("derives the nested repayments mapping slot by hand", () => {
    const field = toHex(BigInt(MINTER_STORAGE_SLOT) + 19n, { size: 32 });
    const perLoan = keccak256(concatHex([pad(toHex(7n), { size: 32 }), field]));
    const expected = keccak256(
      concatHex([pad(toHex(2n), { size: 32 }), perLoan]),
    );
    expect(evmMinterRepaymentSlot(7, 2)).toBe(expected);
    expect(evmMinterRepaymentSlot(7, 2)).toBe(
      "0x2b413c62da38503b4293673f52c4d434f989f997b6bf3c6589abe39a0c8490c5",
    );
  });
});

describe("readEvmMinterRepayment", () => {
  function words(released: bigint, flags: bigint) {
    const base = BigInt(evmMinterRepaymentSlot(7, 2));
    return (slot: Hex) =>
      slot === toHex(base + 2n, { size: 32 })
        ? toHex(released, { size: 32 })
        : slot === toHex(base + 3n, { size: 32 })
          ? toHex(flags, { size: 32 })
          : toHex(0n, { size: 32 });
  }

  const view = { feeShares: 1n, fees: 2n, released: 900n, carvedOut: true };
  const zeroRecord = {
    feeShares: 0n,
    fees: 0n,
    released: 0n,
    carvedOut: false,
  };
  const call = { minter: MINTER, loanId: 7, repaymentId: 2 };

  function viewMissing(served: (slot: Hex) => Hex) {
    mockRead.mockImplementation(
      async ({ functionName, args }: { functionName: string; args: [Hex] }) => {
        if (functionName === "repayment") throw emptyRevert();
        return served(args[0]);
      },
    );
  }

  it("reads the legacy repayment view first", async () => {
    mockRead.mockResolvedValue(view);
    await expect(readEvmMinterRepayment(call)).resolves.toEqual({
      released: "900",
      carvedOut: true,
    });
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockRead.mock.calls[0]![0]).toMatchObject({
      abi: minterRepaymentViewAbi,
      address: MINTER,
      functionName: "repayment",
      args: [7n, 2n],
    });
  });

  it("returns the zero record of a non-existent id without a fallback", async () => {
    mockRead.mockResolvedValue(zeroRecord);
    await expect(readEvmMinterRepayment(call)).resolves.toEqual({
      released: "0",
      carvedOut: false,
    });
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("falls back to words +2 and +3 through extsload when the view reverts with empty data", async () => {
    viewMissing(words(900n, 1n));
    await expect(readEvmMinterRepayment(call)).resolves.toEqual({
      released: "900",
      carvedOut: true,
    });
    const base = BigInt(evmMinterRepaymentSlot(7, 2));
    expect(mockRead).toHaveBeenCalledTimes(3);
    expect(mockRead.mock.calls[0]![0]).toMatchObject({
      abi: minterRepaymentViewAbi,
      functionName: "repayment",
    });
    expect(mockRead.mock.calls.slice(1).map(([c]) => c.args[0])).toEqual([
      toHex(base + 2n, { size: 32 }),
      toHex(base + 3n, { size: 32 }),
    ]);
    expect(mockRead.mock.calls[1]![0]).toMatchObject({
      abi: minterExtsloadAbi,
      address: MINTER,
      functionName: "extsload",
    });
  });

  it("falls back to extsload on a zero-data result", async () => {
    mockRead.mockRejectedValueOnce(
      new ContractFunctionExecutionError(
        new ContractFunctionZeroDataError({ functionName: "repayment" }),
        {
          abi: minterRepaymentViewAbi,
          functionName: "repayment",
          args: [7n, 2n],
        },
      ),
    );
    mockRead.mockImplementation(async ({ args }: { args: [Hex] }) =>
      words(900n, 1n)(args[0]),
    );
    await expect(readEvmMinterRepayment(call)).resolves.toEqual({
      released: "900",
      carvedOut: true,
    });
    expect(mockRead).toHaveBeenCalledTimes(3);
  });

  it("treats only the low byte of word 3 as carvedOut on the fallback", async () => {
    viewMissing(words(5n, (7n << 8n) | 0n));
    await expect(readEvmMinterRepayment(call)).resolves.toEqual({
      released: "5",
      carvedOut: false,
    });
  });

  it("propagates a revert with data without a fallback", async () => {
    const err = new ContractFunctionExecutionError(
      new ContractFunctionRevertedError({
        abi: evmMinterErrorAbi,
        data: "0x118f9b3d",
        functionName: "repayment",
      }),
      {
        abi: minterRepaymentViewAbi,
        functionName: "repayment",
        args: [7n, 2n],
      },
    );
    mockRead.mockRejectedValue(err);
    await expect(readEvmMinterRepayment(call)).rejects.toBe(err);
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("propagates a plain error without a fallback", async () => {
    const err = new Error("rpc down");
    mockRead.mockRejectedValue(err);
    await expect(readEvmMinterRepayment(call)).rejects.toBe(err);
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("forwards blockNumber to the view and to both extsload words", async () => {
    mockRead.mockResolvedValue(view);
    await readEvmMinterRepayment({ ...call, blockNumber: 77n });
    expect(mockRead.mock.calls[0]![0].blockNumber).toBe(77n);
    mockRead.mockReset();
    viewMissing(words(900n, 1n));
    await readEvmMinterRepayment({ ...call, blockNumber: 77n });
    expect(mockRead).toHaveBeenCalledTimes(3);
    for (const [c] of mockRead.mock.calls) expect(c.blockNumber).toBe(77n);
  });

  it("rejects an empty or invalid minter", async () => {
    await expect(
      readEvmMinterRepayment({ minter: "", loanId: 7, repaymentId: 2 }),
    ).rejects.toThrow("readEvmMinterRepayment: minter must not be empty");
    await expect(
      readEvmMinterRepayment({ minter: "nope", loanId: 7, repaymentId: 2 }),
    ).rejects.toThrow(/invalid minter/);
    expect(mockRead).not.toHaveBeenCalled();
  });
});

describe("minterRepaymentViewAbi", () => {
  it("has the selector found in the Hoodi Minter bytecode", () => {
    expect(toFunctionSelector(minterRepaymentViewAbi[0])).toBe("0x1ac459b5");
  });

  it("decodes the 128-byte zero blob Hoodi returned for an unknown id", () => {
    expect(
      decodeFunctionResult({
        abi: minterRepaymentViewAbi,
        functionName: "repayment",
        data: `0x${"00".repeat(128)}`,
      }),
    ).toEqual({ feeShares: 0n, fees: 0n, released: 0n, carvedOut: false });
  });

  it("round-trips a record by field name", () => {
    const record = {
      feeShares: 1n,
      fees: 2n,
      released: 900n,
      carvedOut: true,
    };
    const data = encodeFunctionResult({
      abi: minterRepaymentViewAbi,
      functionName: "repayment",
      result: record,
    });
    expect(
      decodeFunctionResult({
        abi: minterRepaymentViewAbi,
        functionName: "repayment",
        data,
      }),
    ).toEqual(record);
  });
});

describe("readEvmNextRepaymentId", () => {
  it("reads nextRepaymentId from mutableLoanData", async () => {
    mockRead.mockResolvedValue({ nextRepaymentId: 3n });
    await expect(
      readEvmNextRepaymentId({ registry: REGISTRY, loanId: 7 }),
    ).resolves.toBe(3);
    expect(mockRead).toHaveBeenCalledWith({
      abi: evmLoanRegistryRiskCouncilAbi,
      address: REGISTRY,
      functionName: "mutableLoanData",
      args: [7n],
    });
  });
});

describe("readEvmNextRepaymentId at a pinned block", () => {
  it("forwards the block number to the contract read", async () => {
    mockRead.mockResolvedValue({ nextRepaymentId: 1n });
    await readEvmNextRepaymentId({
      registry: REGISTRY,
      loanId: 7,
      blockNumber: 123n,
    });
    expect(mockRead.mock.calls[0]![0].blockNumber).toBe(123n);
  });
});

describe("readEvmRecoveryRepayments", () => {
  const REPAYMENT_ABI = [
    {
      type: "event",
      name: "PaymentRecorded",
      inputs: [
        { name: "loanId", type: "uint256", indexed: true },
        { name: "repaymentId", type: "uint256", indexed: true },
        {
          name: "repayment",
          type: "tuple",
          indexed: false,
          components: [
            { name: "offtakerReceived", type: "uint256" },
            { name: "seniorPrincipalRepaid", type: "uint256" },
            { name: "seniorInterest", type: "uint256" },
            { name: "equityDistributed", type: "uint256" },
            { name: "mgmtFee", type: "uint256" },
            { name: "perfFee", type: "uint256" },
            { name: "oetAlloc", type: "uint256" },
          ],
        },
        { name: "outstanding", type: "uint256", indexed: false },
      ],
    },
    {
      type: "event",
      name: "PaymentUnrecorded",
      inputs: [
        { name: "loanId", type: "uint256", indexed: true },
        { name: "repaymentId", type: "uint256", indexed: true },
        { name: "outstanding", type: "uint256", indexed: false },
      ],
    },
    {
      type: "event",
      name: "CashRepaid",
      inputs: [
        { name: "loanId", type: "uint256", indexed: true },
        { name: "repaymentId", type: "uint256", indexed: false },
        { name: "saleId", type: "uint256", indexed: false },
        { name: "cash", type: "uint256", indexed: false },
        { name: "interestMinted", type: "uint256", indexed: false },
        { name: "feeShares", type: "uint256", indexed: false },
        { name: "valueDate", type: "uint64", indexed: false },
        { name: "refHash", type: "bytes32", indexed: false },
      ],
    },
  ] as const;

  function recorded(loanId: number, repaymentId: number, split: bigint[]) {
    return {
      address: REGISTRY,
      topics: encodeEventTopics({
        abi: REPAYMENT_ABI,
        eventName: "PaymentRecorded",
        args: { loanId: BigInt(loanId), repaymentId: BigInt(repaymentId) },
      }),
      data: encodeAbiParameters(
        [
          {
            type: "tuple",
            components: split.map((_, i) => ({
              name: `f${i}`,
              type: "uint256",
            })),
          },
          { type: "uint256" },
        ],
        [Object.fromEntries(split.map((value, i) => [`f${i}`, value])), 100n],
      ),
      blockNumber: "0x1",
      transactionHash: HASH,
      logIndex: "0x0",
      blockHash: HASH,
      transactionIndex: "0x0",
      removed: false,
    };
  }

  function unrecorded(loanId: number, repaymentId: number) {
    return {
      ...recorded(loanId, repaymentId, [0n, 0n, 0n, 0n, 0n, 0n, 0n]),
      topics: encodeEventTopics({
        abi: REPAYMENT_ABI,
        eventName: "PaymentUnrecorded",
        args: { loanId: BigInt(loanId), repaymentId: BigInt(repaymentId) },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [100n]),
    };
  }

  function cashRepaid(loanId: number, repaymentId: number, cash: bigint) {
    return {
      ...recorded(loanId, repaymentId, [0n, 0n, 0n, 0n, 0n, 0n, 0n]),
      address: MINTER,
      topics: encodeEventTopics({
        abi: REPAYMENT_ABI,
        eventName: "CashRepaid",
        args: { loanId: BigInt(loanId) },
      }),
      data: encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint64" },
          { type: "bytes32" },
        ],
        [BigInt(repaymentId), 3n, cash, 11n, 22n, 1_793_059_200n, HASH],
      ),
    };
  }

  const SPLIT = [1500n, 0n, 1155n, 20n, 120n, 150n, 75n];
  const params = {
    registry: REGISTRY,
    minter: MINTER,
    loanId: 7,
    fromBlock: 4_000_000n,
    chainId: 560048,
  };

  type Mode = "view" | "extsload";

  function arrange(
    logs: unknown[],
    next = 1n,
    released = 900n,
    flags = 1n,
    mode: Mode = "view",
  ) {
    mockScan.mockResolvedValue(logs);
    mockHead.mockResolvedValue(4_500_000n);
    mockRead.mockImplementation(
      async ({ functionName, args }: { functionName: string; args: [Hex] }) => {
        if (functionName === "mutableLoanData") {
          return { nextRepaymentId: next };
        }
        if (functionName === "repayment") {
          if (mode === "extsload") throw emptyRevert();
          return {
            feeShares: 0n,
            fees: 0n,
            released,
            carvedOut: flags !== 0n,
          };
        }
        const base = BigInt(evmMinterRepaymentSlot(7, 0));
        return args[0] === toHex(base + 3n, { size: 32 })
          ? toHex(flags, { size: 32 })
          : toHex(released, { size: 32 });
      },
    );
  }

  it.each<Mode>(["view", "extsload"])(
    "maps a PaymentRecorded and CashRepaid pair into the Stellar row shape (%s)",
    async (mode) => {
      arrange(
        [recorded(7, 0, SPLIT), cashRepaid(7, 0, 1_000n)],
        1n,
        900n,
        1n,
        mode,
      );
      const rows = await readEvmRecoveryRepayments(params);
      expect(rows).toEqual([
        {
          repaymentId: 0,
          repayment: {
            offtaker_received: "1500",
            senior_principal_repaid: "0",
            senior_interest: "1155",
            equity_distributed: "20",
            mgmt_fee: "120",
            perf_fee: "150",
            oet_alloc: "75",
          },
          minter: {
            cash: "1000",
            principal: "900",
            interestMinted: "11",
            feeShares: "22",
            carvedOut: true,
            saleId: 3,
            reversed: false,
          },
          reversed: false,
        },
      ]);
    },
  );

  it("scans both contracts for the three events of this loan from the start block", async () => {
    arrange([recorded(7, 0, SPLIT), cashRepaid(7, 0, 1_000n)]);
    await readEvmRecoveryRepayments(params);
    expect(mockScan).toHaveBeenCalledWith({
      address: [REGISTRY, MINTER],
      topics: [[...EVM_RECOVERY_EVENT_TOPICS], pad(toHex(7n), { size: 32 })],
      fromBlock: 4_000_000n,
      chainId: 560048,
      head: 4_500_000n,
    });
  });

  it.each<Mode>(["view", "extsload"])(
    "pins nextRepaymentId and the Minter reads to the same head as the scan (%s)",
    async (mode) => {
      arrange(
        [recorded(7, 0, SPLIT), cashRepaid(7, 0, 1_000n)],
        1n,
        900n,
        1n,
        mode,
      );
      await readEvmRecoveryRepayments(params);
      expect(mockHead).toHaveBeenCalledTimes(1);
      expect(mockHead).toHaveBeenCalledWith(560048);
      const reads = mockRead.mock.calls.map(([call]) => call);
      expect(reads.length).toBeGreaterThan(1);
      expect(reads.some((call) => call.functionName === "repayment")).toBe(
        true,
      );
      for (const call of reads) expect(call.blockNumber).toBe(4_500_000n);
    },
  );

  it("rejects an invalid Minter address before any RPC call", async () => {
    arrange([]);
    await expect(
      readEvmRecoveryRepayments({ ...params, minter: "0xnope" }),
    ).rejects.toThrow(/VITE_EVM_MINTER_ADDRESS is not a valid EVM address/);
    expect(mockHead).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("marks a repayment with a PaymentUnrecorded as reversed on both shapes", async () => {
    arrange([
      recorded(7, 0, SPLIT),
      cashRepaid(7, 0, 1_000n),
      unrecorded(7, 0),
    ]);
    const [row] = await readEvmRecoveryRepayments(params);
    expect(row?.reversed).toBe(true);
    expect(row?.minter.reversed).toBe(true);
  });

  it("shows principal as the Pocket-unrelease released amount", async () => {
    arrange([recorded(7, 0, SPLIT), cashRepaid(7, 0, 1_000n)], 1n, 321n, 0n);
    const [row] = await readEvmRecoveryRepayments(params);
    expect(row?.minter.principal).toBe("321");
    expect(row?.minter.carvedOut).toBe(false);
  });

  it("throws instead of fabricating a row when a log is missing", async () => {
    arrange([recorded(7, 0, SPLIT)]);
    await expect(readEvmRecoveryRepayments(params)).rejects.toThrow(
      "Repayment #0 was not found on chain from block 4000000; check VITE_EVM_START_BLOCK.",
    );
    arrange([cashRepaid(7, 0, 1_000n)]);
    await expect(readEvmRecoveryRepayments(params)).rejects.toThrow(
      /Repayment #0 was not found on chain/,
    );
  });

  it("ignores the logs of another loan", async () => {
    arrange([recorded(8, 0, SPLIT), cashRepaid(8, 0, 1_000n)]);
    await expect(readEvmRecoveryRepayments(params)).rejects.toThrow(
      /Repayment #0 was not found/,
    );
  });

  it("returns no rows and skips the scan when the loan has no repayments", async () => {
    arrange([], 0n);
    await expect(readEvmRecoveryRepayments(params)).resolves.toEqual([]);
    expect(mockScan).not.toHaveBeenCalled();
  });
});

const W_MINTER = "0x621BaAb0ced6b11f88019582183b081A118755f4";
const W_AM = "0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992";
const W_CALLER = "0x96ef761fee97d6e09821517554f2316b8cbc04e4";
const W_HASH = `0x${"cd".repeat(32)}` as const;
const UINT256_MAX = 2n ** 256n - 1n;

function cashRepaidLog(address: string, repaymentId: bigint) {
  const event = minterRecoveryEvents.find((e) => e.name === "CashRepaid")!;
  return {
    address,
    topics: encodeEventTopics({
      abi: [event],
      eventName: "CashRepaid",
      args: { loanId: 7n },
    }),
    data: encodeAbiParameters(
      event.inputs.filter((i) => !i.indexed),
      [repaymentId, 0n, 1n, 2n, 3n, 1_793_059_200n, W_HASH],
    ),
  };
}

const minterRecoveryEvents = [
  {
    type: "event",
    name: "CashRepaid",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "repaymentId", type: "uint256", indexed: false },
      { name: "saleId", type: "uint256", indexed: false },
      { name: "cash", type: "uint256", indexed: false },
      { name: "interestMinted", type: "uint256", indexed: false },
      { name: "feeShares", type: "uint256", indexed: false },
      { name: "valueDate", type: "uint64", indexed: false },
      { name: "refHash", type: "bytes32", indexed: false },
    ],
    anonymous: false,
  },
] as const;

function simRevert() {
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: evmRepayErrorAbi,
      data: "0x118f9b3d",
      functionName: "repay",
    }),
    { abi: minterRecoveryAbi, functionName: "repay", args: [] },
  );
}

function emptyRevert() {
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: minterDisburseAbi,
      functionName: "bankCash",
      message: "execution reverted",
    }),
    { abi: minterDisburseAbi, functionName: "bankCash" },
  );
}

describe("evmRepaymentRefHash", () => {
  const input = { registry: REGISTRY, loanId: 7, nextRepaymentId: 0 };

  it("checksums the registry and prefixes 0x", async () => {
    await expect(evmRepaymentRefHash(input)).resolves.toBe(
      "0x147c2b75249c782e7d0f48894e317f7ce065f657ed87c93b10a163c00cbb55bd",
    );
  });

  it("changes with each input", async () => {
    const base = await evmRepaymentRefHash(input);
    const others = await Promise.all([
      evmRepaymentRefHash({ ...input, registry: MINTER }),
      evmRepaymentRefHash({ ...input, loanId: 8 }),
      evmRepaymentRefHash({ ...input, nextRepaymentId: 1 }),
    ]);
    expect(new Set([base, ...others]).size).toBe(4);
  });
});

describe("repay validation", () => {
  const input = {
    loanId: 7,
    repayment: REPAYMENT,
    valueDate: 1_793_059_200,
    refHash: W_HASH,
  };

  it.each([
    ["valueDate 0", { valueDate: 0 }],
    ["valueDate -1", { valueDate: -1 }],
    ["valueDate 1.5", { valueDate: 1.5 }],
    ["loanId -1", { loanId: -1 }],
    ["saleId -1", { saleId: -1 }],
    ["fraction", { repayment: { ...REPAYMENT, mgmt_fee: "1.5" } }],
    [
      "above uint256",
      { repayment: { ...REPAYMENT, perf_fee: (UINT256_MAX + 1n).toString() } },
    ],
    ["zero hash", { refHash: `0x${"0".repeat(64)}` }],
    ["bad hash", { refHash: "0x12" }],
  ])("rejects %s before any send", async (_n, patch) => {
    mockSend.mockReset();
    expect(() => encodeEvmRepayCalldata({ ...input, ...patch })).toThrow();
    await expect(
      repayEvmLoan({
        minter: W_MINTER,
        caller: W_CALLER,
        chainId: 560048,
        ...input,
        ...patch,
      }),
    ).rejects.toThrow(/repayEvmLoan: /);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("accepts uint256 max", () => {
    expect(() =>
      encodeEvmRepayCalldata({
        ...input,
        repayment: { ...REPAYMENT, oet_alloc: UINT256_MAX.toString() },
      }),
    ).not.toThrow();
  });
});

describe("readEvmRepaymentId", () => {
  const receipt = (...logs: ReturnType<typeof cashRepaidLog>[]) =>
    ({ logs }) as never;

  it("reads the id from the Minter log, case-insensitively", () => {
    expect(
      readEvmRepaymentId(
        receipt(cashRepaidLog(W_MINTER.toLowerCase(), 4n)),
        W_MINTER,
      ),
    ).toBe(4);
  });

  it("returns 0 as 0", () => {
    expect(
      readEvmRepaymentId(receipt(cashRepaidLog(W_MINTER, 0n)), W_MINTER),
    ).toBe(0);
  });

  it("ignores other emitters, empty logs and unsafe ids", () => {
    expect(
      readEvmRepaymentId(receipt(cashRepaidLog(W_AM, 4n)), W_MINTER),
    ).toBeNull();
    expect(readEvmRepaymentId(receipt(), W_MINTER)).toBeNull();
    expect(
      readEvmRepaymentId(
        receipt(cashRepaidLog(W_MINTER, BigInt(Number.MAX_SAFE_INTEGER) + 1n)),
        W_MINTER,
      ),
    ).toBeNull();
  });
});

describe("repayEvmLoan", () => {
  const input = {
    minter: W_MINTER,
    caller: W_CALLER,
    chainId: 560048,
    loanId: 7,
    repayment: REPAYMENT,
    valueDate: 1_793_059_200,
    refHash: W_HASH,
  };

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({
      hash: HASH,
      receipt: { status: "success", logs: [cashRepaidLog(W_MINTER, 2n)] },
    });
  });

  it("calls PipelineMinter.repay directly", async () => {
    await expect(repayEvmLoan(input)).resolves.toEqual({
      hash: HASH,
      repaymentId: 2,
    });
    const call = mockSend.mock.calls[0]![0];
    expect(call).toMatchObject({
      address: W_MINTER,
      functionName: "repay",
      account: W_CALLER,
      chainId: 560048,
    });
    expect(call.args).toEqual([
      7n,
      {
        offtakerReceived: 1500000000000n,
        seniorPrincipalRepaid: 10n,
        seniorInterest: 1155000000000n,
        equityDistributed: 20n,
        mgmtFee: 120000000000n,
        perfFee: 150000000000n,
        oetAlloc: 75000000000n,
      },
      1_793_059_200n,
      W_HASH,
      0n,
    ]);
    const names = call.abi.map((i: { name?: string }) => i.name);
    for (const name of [
      "repay",
      "MinterRefHashSeen",
      "RateLimiterExceedsTxLimit",
      "DealTokenFactoryNotRegistered",
      "LoanRegistryWrongCurrentStatus",
      "EnforcedPause",
      "AccessManagedUnauthorized",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("returns null without a CashRepaid log", async () => {
    mockSend.mockResolvedValue({
      hash: HASH,
      receipt: { status: "success", logs: [] },
    });
    await expect(repayEvmLoan(input)).resolves.toEqual({
      hash: HASH,
      repaymentId: null,
    });
  });

  it("labels a simulation revert", async () => {
    mockSend.mockRejectedValue(simRevert());
    await expect(repayEvmLoan(input)).rejects.toThrow(
      /^repayEvmLoan: simulation error: /,
    );
  });

  it("rejects bad addresses before any call", async () => {
    await expect(repayEvmLoan({ ...input, minter: "" })).rejects.toThrow(
      "repayEvmLoan: minter must not be empty",
    );
    await expect(repayEvmLoan({ ...input, caller: "x" })).rejects.toThrow(
      "repayEvmLoan: invalid caller x",
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("disburse", () => {
  const input = {
    loanId: 7,
    amountRaw: "1000000",
    valueDate: 1_795_046_400,
    refHash: W_HASH,
  };

  it("pins the selector", () => {
    expect(evmDisburseSelector()).toBe("0x1d492b02");
  });

  it("round-trips through decodeFunctionData", () => {
    const decoded = decodeFunctionData({
      abi: minterDisburseAbi,
      data: encodeEvmDisburseCalldata(input),
    });
    expect(decoded.functionName).toBe("disburse");
    expect(decoded.args).toEqual([7n, 1_000_000n, 1_795_046_400n, W_HASH]);
  });

  it.each([
    ["id -1", { loanId: -1 }],
    ["amount 0", { amountRaw: "0" }],
    ["amount 1.5", { amountRaw: "1.5" }],
    ["amount above uint256", { amountRaw: (UINT256_MAX + 1n).toString() }],
    ["valueDate 0", { valueDate: 0 }],
    ["zero hash", { refHash: `0x${"0".repeat(64)}` }],
    ["bad hash", { refHash: "0x12" }],
  ])("rejects %s before any send", async (_n, patch) => {
    mockSend.mockReset();
    expect(() => encodeEvmDisburseCalldata({ ...input, ...patch })).toThrow();
    await expect(
      disburseEvmLoan({
        accessManager: W_AM,
        minter: W_MINTER,
        caller: W_CALLER,
        chainId: 560048,
        ...input,
        ...patch,
      }),
    ).rejects.toThrow(/encodeEvmDisburseCalldata: /);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends AccessManager.execute(minter, calldata)", async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({
      hash: HASH,
      receipt: { status: "success", logs: [] },
    });
    await expect(
      disburseEvmLoan({
        accessManager: W_AM,
        minter: W_MINTER,
        caller: W_CALLER,
        chainId: 560048,
        ...input,
      }),
    ).resolves.toEqual({ hash: HASH });
    const call = mockSend.mock.calls[0]![0];
    expect(call).toMatchObject({
      address: W_AM,
      functionName: "execute",
      args: [W_MINTER, encodeEvmDisburseCalldata(input)],
      value: 0n,
      account: W_CALLER,
      chainId: 560048,
    });
    const names = call.abi.map((i: { name?: string }) => i.name);
    for (const name of [
      "execute",
      "AccessManagerUnauthorizedCall",
      "MinterInsufficientBankCash",
      "LoanRegistryDisbursementExceedsTranche",
      "DealTokenFactoryNotRegistered",
      "EnforcedPause",
    ]) {
      expect(names).toContain(name);
    }
    expect(evmDisburseErrorAbi.length).toBeGreaterThan(0);
  });

  it("labels a simulation revert", async () => {
    mockSend.mockReset();
    mockSend.mockRejectedValue(simRevert());
    await expect(
      disburseEvmLoan({
        accessManager: W_AM,
        minter: W_MINTER,
        caller: W_CALLER,
        chainId: 560048,
        ...input,
      }),
    ).rejects.toThrow(/^disburseEvmLoan: simulation error: /);
  });
});

describe("Minter disburse reads", () => {
  const REF =
    "0x72c162575adea091c5fc1bed0ec9321fda14c9706338e043ff9d01aeb652a6ce";
  const SEEN_SLOT =
    "0x651ff56ec546131f0d72943f5ad3dfc6fc4c9cafebceb89c942c15699418fa60";

  beforeEach(() => {
    mockRead.mockReset();
  });

  it("pins the storage fields", () => {
    expect(MINTER_BANK_CASH_FIELD).toBe(8n);
    expect(MINTER_REF_HASHES_SEEN_FIELD).toBe(20n);
  });

  it("reads paused from the view", async () => {
    mockRead.mockResolvedValue(true);
    await expect(readEvmMinterPaused({ minter: W_MINTER })).resolves.toBe(true);
    expect(mockRead.mock.calls[0]![0]).toMatchObject({
      address: W_MINTER,
      functionName: "paused",
    });
  });

  it("uses the legacy bankCash view", async () => {
    mockRead.mockResolvedValue(2_500_000n);
    await expect(readEvmMinterBankCash({ minter: W_MINTER })).resolves.toBe(
      "2500000",
    );
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("falls back to extsload when the view reverts with empty data", async () => {
    mockRead.mockRejectedValueOnce(emptyRevert());
    mockRead.mockResolvedValueOnce(toHex(42n, { size: 32 }));
    await expect(readEvmMinterBankCash({ minter: W_MINTER })).resolves.toBe(
      "42",
    );
    expect(mockRead.mock.calls[1]![0]).toMatchObject({
      functionName: "extsload",
      args: [toHex(BigInt(MINTER_STORAGE_SLOT) + 8n, { size: 32 })],
    });
  });

  it("falls back on a zero-data result", async () => {
    mockRead.mockRejectedValueOnce(
      new ContractFunctionExecutionError(
        new ContractFunctionZeroDataError({ functionName: "bankCash" }),
        { abi: minterDisburseAbi, functionName: "bankCash" },
      ),
    );
    mockRead.mockResolvedValueOnce(toHex(0n, { size: 32 }));
    await expect(readEvmMinterBankCash({ minter: W_MINTER })).resolves.toBe(
      "0",
    );
  });

  it("propagates a revert with data and RPC errors", async () => {
    const withData = new ContractFunctionExecutionError(
      new ContractFunctionRevertedError({
        abi: evmRepayErrorAbi,
        data: "0x118f9b3d",
        functionName: "bankCash",
      }),
      { abi: minterDisburseAbi, functionName: "bankCash" },
    );
    mockRead.mockRejectedValueOnce(withData);
    await expect(readEvmMinterBankCash({ minter: W_MINTER })).rejects.toBe(
      withData,
    );
    const rpc = new Error("rpc down");
    mockRead.mockRejectedValueOnce(rpc);
    await expect(
      readEvmRefHashSeen({ minter: W_MINTER, refHash: REF }),
    ).rejects.toBe(rpc);
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it("uses the legacy refHashSeen view", async () => {
    mockRead.mockResolvedValue(true);
    await expect(
      readEvmRefHashSeen({ minter: W_MINTER, refHash: REF }),
    ).resolves.toBe(true);
    expect(mockRead.mock.calls[0]![0]).toMatchObject({
      functionName: "refHashSeen",
      args: [REF],
    });
  });

  it("falls back to extsload at the pinned mapping slot", async () => {
    mockRead.mockRejectedValueOnce(emptyRevert());
    mockRead.mockResolvedValueOnce(toHex(1n, { size: 32 }));
    await expect(
      readEvmRefHashSeen({ minter: W_MINTER, refHash: REF }),
    ).resolves.toBe(true);
    expect(mockRead.mock.calls[1]![0]).toMatchObject({
      functionName: "extsload",
      args: [SEEN_SLOT],
    });
    mockRead.mockRejectedValueOnce(emptyRevert());
    mockRead.mockResolvedValueOnce(toHex(0n, { size: 32 }));
    await expect(
      readEvmRefHashSeen({ minter: W_MINTER, refHash: REF }),
    ).resolves.toBe(false);
  });

  it("rejects bad input before any read", async () => {
    await expect(readEvmMinterPaused({ minter: "" })).rejects.toThrow(
      /minter must not be empty/,
    );
    await expect(
      readEvmRefHashSeen({ minter: W_MINTER, refHash: "0x1" }),
    ).rejects.toThrow(/64 hex characters/);
    expect(mockRead).not.toHaveBeenCalled();
  });
});

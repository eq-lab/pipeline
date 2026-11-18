// spec: docs/product-specs/loan-repayment-recovery.md
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
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

const { mockRead, mockScan, mockRelay, mockSchedule } = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockScan: vi.fn(),
  mockRelay: vi.fn(),
  mockSchedule: vi.fn(),
}));

vi.mock("./write", () => ({
  readEvmContract: mockRead,
  sendEvmContractCall: vi.fn(),
}));
vi.mock("./accessManager", () => ({
  relayEvm: mockRelay,
  readEvmOperationSchedule: mockSchedule,
}));
vi.mock("./logs", async () => {
  const actual = await vi.importActual<typeof import("./logs")>("./logs");
  return { ...actual, scanEvmLogs: mockScan };
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
  readEvmMinterRepayment,
  readEvmNextRepaymentId,
  readEvmRecoveryRepayments,
  readEvmReverseRepaySchedule,
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

  it("reads words +2 and +3 through extsload", async () => {
    mockRead.mockImplementation(async ({ args }: { args: [Hex] }) =>
      words(900n, 1n)(args[0]),
    );
    await expect(
      readEvmMinterRepayment({ minter: MINTER, loanId: 7, repaymentId: 2 }),
    ).resolves.toEqual({ released: "900", carvedOut: true });
    const base = BigInt(evmMinterRepaymentSlot(7, 2));
    expect(mockRead.mock.calls.map(([call]) => call.args[0])).toEqual([
      toHex(base + 2n, { size: 32 }),
      toHex(base + 3n, { size: 32 }),
    ]);
    expect(mockRead.mock.calls[0]![0]).toMatchObject({
      abi: minterExtsloadAbi,
      address: MINTER,
      functionName: "extsload",
    });
  });

  it("treats only the low byte of word 3 as carvedOut", async () => {
    mockRead.mockImplementation(async ({ args }: { args: [Hex] }) =>
      words(5n, (7n << 8n) | 0n)(args[0]),
    );
    await expect(
      readEvmMinterRepayment({ minter: MINTER, loanId: 7, repaymentId: 2 }),
    ).resolves.toEqual({ released: "5", carvedOut: false });
  });

  it("rejects an empty or invalid minter", async () => {
    await expect(
      readEvmMinterRepayment({ minter: "", loanId: 7, repaymentId: 2 }),
    ).rejects.toThrow("readEvmMinterRepayment: minter must not be empty");
    await expect(
      readEvmMinterRepayment({ minter: "nope", loanId: 7, repaymentId: 2 }),
    ).rejects.toThrow(/invalid minter/);
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

  function arrange(logs: unknown[], next = 1n, released = 900n, flags = 1n) {
    mockScan.mockResolvedValue(logs);
    mockRead.mockImplementation(
      async ({ functionName, args }: { functionName: string; args: [Hex] }) => {
        if (functionName === "mutableLoanData") {
          return { nextRepaymentId: next };
        }
        const base = BigInt(evmMinterRepaymentSlot(7, 0));
        return args[0] === toHex(base + 3n, { size: 32 })
          ? toHex(flags, { size: 32 })
          : toHex(released, { size: 32 });
      },
    );
  }

  it("maps a PaymentRecorded and CashRepaid pair into the Stellar row shape", async () => {
    arrange([recorded(7, 0, SPLIT), cashRepaid(7, 0, 1_000n)]);
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
  });

  it("scans both contracts for the three events of this loan from the start block", async () => {
    arrange([recorded(7, 0, SPLIT), cashRepaid(7, 0, 1_000n)]);
    await readEvmRecoveryRepayments(params);
    expect(mockScan).toHaveBeenCalledWith({
      address: [REGISTRY, MINTER],
      topics: [[...EVM_RECOVERY_EVENT_TOPICS], pad(toHex(7n), { size: 32 })],
      fromBlock: 4_000_000n,
      chainId: 560048,
    });
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

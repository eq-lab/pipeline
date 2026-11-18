// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, toFunctionSelector } from "viem";

const { mockRead, mockRelay, mockSchedule } = vi.hoisted(() => ({
  mockRead: vi.fn(),
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

import {
  EVM_CLOSURE_REASONS,
  EVM_LOAN_STATUSES,
  EVM_RISK_COUNCIL_FUNCTION_NAMES,
  encodeEvmRiskCouncilCalldata,
  evmLoanRegistryRiskCouncilAbi,
  evmRiskCouncilErrorAbi,
  evmRiskCouncilSelector,
  readEvmLoanChainState,
  readEvmLoanMoney,
  readEvmRiskCouncilSchedule,
  relayEvmRiskCouncil,
} from "./riskCouncil";
import type { RiskCouncilCall } from "../../stellar/contracts/riskCouncil";

const HASH = "ab".repeat(32);
const REGISTRY = "0x00000000000000000000000000000000000000b1";
const AM = "0x00000000000000000000000000000000000000a1";
const CALLER = "0x00000000000000000000000000000000000000c1";
const INT256_MAX = 2n ** 255n - 1n;

function decode(call: RiskCouncilCall) {
  return decodeFunctionData({
    abi: evmLoanRegistryRiskCouncilAbi,
    data: encodeEvmRiskCouncilCalldata(call),
  });
}

beforeEach(() => {
  mockRead.mockReset();
  mockRelay.mockReset();
  mockSchedule.mockReset();
});

describe("selectors pinned to contracts 150631a", () => {
  const SELECTORS: Record<RiskCouncilCall["fn"], string> = {
    set_default: "0xe0da6b66",
    cure: "0xb7e5262a",
    amend_economics: "0x00b14774",
    adjust_interest: "0x6d10dec4",
    write_down: "0x5bd45aa1",
    close_defaulted: "0x7892936e",
  };
  const SIGNATURES: Record<RiskCouncilCall["fn"], string> = {
    set_default: "setDefault(uint256)",
    cure: "cure(uint256)",
    amend_economics: "amendEconomics(uint256,uint32,uint64)",
    adjust_interest: "adjustInterest(uint256,int256,bytes32)",
    write_down: "writeDown(uint256,uint256)",
    close_defaulted: "closeDefaulted(uint256,uint8)",
  };

  it.each(Object.keys(SELECTORS) as RiskCouncilCall["fn"][])("%s", (fn) => {
    expect(evmRiskCouncilSelector(fn)).toBe(SELECTORS[fn]);
    expect(evmRiskCouncilSelector(fn)).toBe(toFunctionSelector(SIGNATURES[fn]));
  });

  it("maps every logical call to its Solidity name", () => {
    expect(EVM_RISK_COUNCIL_FUNCTION_NAMES).toEqual({
      set_default: "setDefault",
      cure: "cure",
      amend_economics: "amendEconomics",
      adjust_interest: "adjustInterest",
      write_down: "writeDown",
      close_defaulted: "closeDefaulted",
    });
  });

  it("pins the view selectors", () => {
    expect(toFunctionSelector("mutableLoanData(uint256)")).toBe("0xd59000e4");
    expect(toFunctionSelector("loanMoney(uint256)")).toBe("0x51e89bc7");
  });
});

describe("enum ordinals", () => {
  it("matches ILoanRegistry.LoanStatus and ClosureReason", () => {
    expect([...EVM_LOAN_STATUSES]).toEqual([
      "Approved",
      "Performing",
      "WatchList",
      "Default",
      "Closed",
    ]);
    expect([...EVM_CLOSURE_REASONS]).toEqual([
      "None",
      "ScheduledMaturity",
      "EarlyRepayment",
      "Cancelled",
      "Default",
      "OtherWriteDown",
    ]);
    expect(EVM_CLOSURE_REASONS.indexOf("Default")).toBe(4);
    expect(EVM_CLOSURE_REASONS.indexOf("OtherWriteDown")).toBe(5);
  });
});

describe("encodeEvmRiskCouncilCalldata", () => {
  it("round-trips set_default and cure", () => {
    expect(decode({ fn: "set_default", loanId: 7 })).toMatchObject({
      functionName: "setDefault",
      args: [7n],
    });
    expect(decode({ fn: "cure", loanId: 7 })).toMatchObject({
      functionName: "cure",
      args: [7n],
    });
  });

  it("encodes amend_economics with the bps x 100 uint32 scale", () => {
    const decoded = decode({
      fn: "amend_economics",
      loanId: 7,
      rateBps: 1450,
      maturity: 1767225600,
    });
    expect(decoded.functionName).toBe("amendEconomics");
    expect(decoded.args).toEqual([7n, 145000, 1767225600n]);
  });

  it("encodes a negative delta as int256 and the hash with 0x", () => {
    const decoded = decode({
      fn: "adjust_interest",
      loanId: 7,
      delta: "-5000000",
      reasonHash: HASH,
    });
    expect(decoded.functionName).toBe("adjustInterest");
    expect(decoded.args).toEqual([7n, -5000000n, `0x${HASH}`]);
  });

  it("encodes write_down at the raw amount", () => {
    expect(
      decode({ fn: "write_down", loanId: 7, amount: "1000000001" }).args,
    ).toEqual([7n, 1000000001n]);
  });

  it("encodes the closure reason ordinals 4 and 5", () => {
    expect(
      decode({ fn: "close_defaulted", loanId: 7, reason: "Default" }).args,
    ).toEqual([7n, 4]);
    expect(
      decode({ fn: "close_defaulted", loanId: 7, reason: "OtherWriteDown" })
        .args,
    ).toEqual([7n, 5]);
  });

  it("prefixes calldata with the pinned selector", () => {
    expect(
      encodeEvmRiskCouncilCalldata({ fn: "set_default", loanId: 1 }).slice(
        0,
        10,
      ),
    ).toBe("0xe0da6b66");
  });

  it.each<[string, RiskCouncilCall]>([
    ["rate 0", { fn: "amend_economics", loanId: 1, rateBps: 0, maturity: 1 }],
    [
      "rate 10001",
      { fn: "amend_economics", loanId: 1, rateBps: 10001, maturity: 1 },
    ],
    [
      "rate 1.5",
      { fn: "amend_economics", loanId: 1, rateBps: 1.5, maturity: 1 },
    ],
    [
      "maturity 0",
      { fn: "amend_economics", loanId: 1, rateBps: 100, maturity: 0 },
    ],
    [
      "delta 0",
      { fn: "adjust_interest", loanId: 1, delta: "0", reasonHash: HASH },
    ],
    [
      "delta 1.5",
      { fn: "adjust_interest", loanId: 1, delta: "1.5", reasonHash: HASH },
    ],
    [
      "delta above int256",
      {
        fn: "adjust_interest",
        loanId: 1,
        delta: (INT256_MAX + 1n).toString(),
        reasonHash: HASH,
      },
    ],
    [
      "bad hash",
      { fn: "adjust_interest", loanId: 1, delta: "1", reasonHash: `0x${HASH}` },
    ],
    ["amount 0", { fn: "write_down", loanId: 1, amount: "0" }],
    ["amount negative", { fn: "write_down", loanId: 1, amount: "-1" }],
    [
      "unknown reason",
      {
        fn: "close_defaulted",
        loanId: 1,
        reason: "Cancelled" as unknown as "Default",
      },
    ],
    ["negative id", { fn: "set_default", loanId: -1 }],
    ["unsafe id", { fn: "cure", loanId: 2 ** 53 }],
  ])("rejects %s", (_name, call) => {
    expect(() => encodeEvmRiskCouncilCalldata(call)).toThrow(
      /encodeEvmRiskCouncilCalldata: invalid/,
    );
  });

  it("accepts the int256 bounds", () => {
    expect(() =>
      encodeEvmRiskCouncilCalldata({
        fn: "adjust_interest",
        loanId: 1,
        delta: INT256_MAX.toString(),
        reasonHash: HASH,
      }),
    ).not.toThrow();
    expect(() =>
      encodeEvmRiskCouncilCalldata({
        fn: "adjust_interest",
        loanId: 1,
        delta: (-(2n ** 255n)).toString(),
        reasonHash: HASH,
      }),
    ).not.toThrow();
  });
});

describe("relay and schedule", () => {
  const call: RiskCouncilCall = { fn: "set_default", loanId: 7 };

  it("relays to the registry with the LoanRegistry error ABI", async () => {
    mockRelay.mockResolvedValue({ hash: "0xabc" });
    const onStageChange = vi.fn();
    await relayEvmRiskCouncil({
      mode: "schedule",
      call,
      accessManager: AM,
      registry: REGISTRY,
      caller: CALLER,
      chainId: 560048,
      onStageChange,
    });
    expect(mockRelay).toHaveBeenCalledWith({
      mode: "schedule",
      accessManager: AM,
      caller: CALLER,
      chainId: 560048,
      onStageChange,
      target: REGISTRY,
      data: encodeEvmRiskCouncilCalldata(call),
      errorAbi: evmRiskCouncilErrorAbi,
    });
  });

  it("reads the schedule of the same calldata", async () => {
    mockSchedule.mockResolvedValue({ operationId: "aa", readyAt: 5 });
    await expect(
      readEvmRiskCouncilSchedule({
        call,
        accessManager: AM,
        registry: REGISTRY,
        caller: CALLER,
      }),
    ).resolves.toEqual({ operationId: "aa", readyAt: 5 });
    expect(mockSchedule).toHaveBeenCalledWith({
      accessManager: AM,
      caller: CALLER,
      target: REGISTRY,
      data: encodeEvmRiskCouncilCalldata(call),
    });
  });

  it("carries the LoanRegistry errors and EnforcedPause", () => {
    const names = evmRiskCouncilErrorAbi.map((item) =>
      "name" in item ? item.name : "",
    );
    expect(names).toContain("LoanRegistryWrongCurrentStatus");
    expect(names).toContain("LoanRegistryRepaymentAlreadyReversed");
    expect(names).toContain("EnforcedPause");
  });
});

describe("readEvmLoanChainState", () => {
  const data = {
    nextEconomicsEpochsId: 1n,
    nextRepaymentId: 2n,
    status: 3,
    currentMaturityTimestamp: 1767225600n,
    currentRate: 145000,
    closureReason: 3,
    carvedOut: true,
    disbursed: 10n,
    repaid: 4n,
    writtenDown: 2n,
    interestAdjustment: -7n,
    metadataURI: "ipfs://x",
  };

  it("maps ordinals to the Stellar enum names and keeps the sign", async () => {
    mockRead.mockResolvedValue(data);
    await expect(
      readEvmLoanChainState({ registry: REGISTRY, loanId: 7 }),
    ).resolves.toEqual({
      status: "Default",
      closureReason: "Cancelled",
      currentRate: 145000,
      currentMaturity: 1767225600,
      interestAdjustment: "-7",
      writtenDown: "2",
      carvedOut: true,
      metadataUri: "ipfs://x",
    });
    expect(mockRead).toHaveBeenCalledWith({
      abi: evmLoanRegistryRiskCouncilAbi,
      address: REGISTRY,
      functionName: "mutableLoanData",
      args: [7n],
    });
  });

  it("throws on an out-of-range ordinal", async () => {
    mockRead.mockResolvedValue({ ...data, status: 9 });
    await expect(
      readEvmLoanChainState({ registry: REGISTRY, loanId: 7 }),
    ).rejects.toThrow(/unknown status 9/);
    mockRead.mockResolvedValue({ ...data, closureReason: 6 });
    await expect(
      readEvmLoanChainState({ registry: REGISTRY, loanId: 7 }),
    ).rejects.toThrow(/unknown closure reason 6/);
  });

  it("rejects an empty or invalid registry", async () => {
    await expect(
      readEvmLoanChainState({ registry: "", loanId: 7 }),
    ).rejects.toThrow("readEvmLoanChainState: registry must not be empty");
    await expect(
      readEvmLoanChainState({ registry: "nope", loanId: 7 }),
    ).rejects.toThrow(/invalid registry/);
  });
});

describe("readEvmLoanMoney", () => {
  it("maps all six fields as decimal strings", async () => {
    mockRead.mockResolvedValue({
      disbursed: 10n,
      repaid: 4n,
      writtenDown: 2n,
      outstanding: 4n,
      accruedInterest: 1n,
      carvedOut: false,
    });
    await expect(
      readEvmLoanMoney({ registry: REGISTRY, loanId: 7 }),
    ).resolves.toEqual({
      disbursed: "10",
      repaid: "4",
      writtenDown: "2",
      outstanding: "4",
      accruedInterest: "1",
      carvedOut: false,
    });
    expect(mockRead).toHaveBeenCalledWith({
      abi: evmLoanRegistryRiskCouncilAbi,
      address: REGISTRY,
      functionName: "loanMoney",
      args: [7n],
    });
  });

  it("rejects an empty registry", async () => {
    await expect(readEvmLoanMoney({ registry: "", loanId: 7 })).rejects.toThrow(
      "readEvmLoanMoney: registry must not be empty",
    );
  });
});

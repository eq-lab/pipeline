// spec: docs/product-specs/loan-repayment-recovery.md
import { describe, it, expect } from "vitest";
import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  toFunctionSelector,
} from "viem";
import {
  minterRecoveryAbi,
  minterWireOutAbi,
  EVM_WIRE_OUT_STATUS,
  encodeEvmReverseRepayCalldata,
  encodeEvmRepayCalldata,
} from "./minter";

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

describe("minterWireOutAbi", () => {
  const LP = "0x1111111111111111111111111111111111111111" as const;

  it("round-trips requestWireOut(uint256)", () => {
    const data = encodeFunctionData({
      abi: minterWireOutAbi,
      functionName: "requestWireOut",
      args: [25n],
    });
    expect(data.slice(0, 10)).toBe(
      toFunctionSelector("requestWireOut(uint256)"),
    );
    expect(decodeFunctionData({ abi: minterWireOutAbi, data }).args).toEqual([
      25n,
    ]);
  });

  it("decodes the wireOut tuple (lp, status, amount)", () => {
    const data = encodeFunctionResult({
      abi: minterWireOutAbi,
      functionName: "wireOut",
      result: { lp: LP, status: 2, amount: 5n },
    });
    expect(
      decodeFunctionResult({
        abi: minterWireOutAbi,
        functionName: "wireOut",
        data,
      }),
    ).toEqual({ lp: LP, status: 2, amount: 5n });
  });

  it("decodes WireOutRequested from a log", () => {
    const topics = encodeEventTopics({
      abi: minterWireOutAbi,
      eventName: "WireOutRequested",
      args: { id: 7n, lp: LP },
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [9n]);
    const decoded = decodeEventLog({
      abi: minterWireOutAbi,
      topics: topics as [`0x${string}`, ...`0x${string}`[]],
      data,
    });
    expect(decoded.eventName).toBe("WireOutRequested");
    expect(decoded.args).toEqual({ id: 7n, lp: LP, amount: 9n });
  });

  it("maps status indices to labels", () => {
    expect(EVM_WIRE_OUT_STATUS[0]).toBe("Pending");
    expect(EVM_WIRE_OUT_STATUS[1]).toBe("Settled");
    expect(EVM_WIRE_OUT_STATUS[2]).toBe("Cancelled");
  });
});

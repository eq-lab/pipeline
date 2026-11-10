// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";

const { mockRelay, mockReadOperationSchedule, mockSimulateRead } = vi.hoisted(
  () => ({
    mockRelay: vi.fn(),
    mockReadOperationSchedule: vi.fn(),
    mockSimulateRead: vi.fn(),
  }),
);

vi.mock("./accessManager", () => ({
  relay: mockRelay,
  readOperationSchedule: mockReadOperationSchedule,
}));
vi.mock("./simulateRead", () => ({ simulateRead: mockSimulateRead }));

import {
  encodeRiskCouncilArgs,
  relayRiskCouncil,
  readRiskCouncilSchedule,
  riskCouncilReasonHash,
  readLoanMoney,
  readLoanChainState,
} from "./riskCouncil";

const HASH = "ab".repeat(32);
const base = {
  registryId: "CREG",
  rpcUrl: "https://rpc.test",
  networkPassphrase: "Test SDF Network ; September 2015",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("encodeRiskCouncilArgs", () => {
  it("set_default and cure encode [u32]", () => {
    for (const fn of ["set_default", "cure"] as const) {
      const args = encodeRiskCouncilArgs({ fn, loanId: 7 });
      expect(args.map((a) => a.switch().name)).toEqual(["scvU32"]);
      expect(scValToNative(args[0]!)).toBe(7);
    }
  });

  it("amend_economics scales the rate by 100 and encodes u64 maturity", () => {
    const args = encodeRiskCouncilArgs({
      fn: "amend_economics",
      loanId: 3,
      rateBps: 1450,
      maturity: 1_800_000_000,
    });
    expect(args.map((a) => a.switch().name)).toEqual([
      "scvU32",
      "scvU32",
      "scvU64",
    ]);
    expect(scValToNative(args[1]!)).toBe(145000);
    expect(scValToNative(args[2]!)).toBe(1_800_000_000n);
  });

  it("adjust_interest keeps the sign as i128 and the reason hash as bytes", () => {
    const args = encodeRiskCouncilArgs({
      fn: "adjust_interest",
      loanId: 1,
      delta: "-10005000000",
      reasonHash: HASH,
    });
    expect(args.map((a) => a.switch().name)).toEqual([
      "scvU32",
      "scvI128",
      "scvBytes",
    ]);
    expect(scValToNative(args[1]!)).toBe(-10005000000n);
    expect(
      Buffer.from(scValToNative(args[2]!) as Uint8Array).toString("hex"),
    ).toBe(HASH);
  });

  it("write_down encodes u128", () => {
    const args = encodeRiskCouncilArgs({
      fn: "write_down",
      loanId: 1,
      amount: "5000000000",
    });
    expect(args.map((a) => a.switch().name)).toEqual(["scvU32", "scvU128"]);
    expect(scValToNative(args[1]!)).toBe(5000000000n);
  });

  it("close_defaulted encodes the reason as vec[symbol]", () => {
    const args = encodeRiskCouncilArgs({
      fn: "close_defaulted",
      loanId: 1,
      reason: "OtherWriteDown",
    });
    expect(args[1]!.switch().name).toBe("scvVec");
    expect(scValToNative(args[1]!)).toEqual(["OtherWriteDown"]);
  });

  it("rejects bad input", () => {
    const bad = (call: Parameters<typeof encodeRiskCouncilArgs>[0]) =>
      expect(() => encodeRiskCouncilArgs(call)).toThrow(
        /encodeRiskCouncilArgs/,
      );
    bad({ fn: "set_default", loanId: -1 });
    bad({ fn: "set_default", loanId: 1.5 });
    bad({ fn: "amend_economics", loanId: 1, rateBps: 0, maturity: 1 });
    bad({ fn: "amend_economics", loanId: 1, rateBps: 10_001, maturity: 1 });
    bad({ fn: "amend_economics", loanId: 1, rateBps: 100, maturity: 0 });
    bad({ fn: "write_down", loanId: 1, amount: "0" });
    bad({ fn: "write_down", loanId: 1, amount: "-5" });
    bad({ fn: "adjust_interest", loanId: 1, delta: "0", reasonHash: HASH });
    bad({ fn: "adjust_interest", loanId: 1, delta: "1.5", reasonHash: HASH });
    bad({ fn: "adjust_interest", loanId: 1, delta: "5", reasonHash: "zz" });
  });
});

describe("relayRiskCouncil / readRiskCouncilSchedule", () => {
  it("relays with target = registry, fn and encoded args in both modes", async () => {
    mockRelay.mockResolvedValue({ hash: "H" });
    for (const mode of ["schedule", "execute"] as const) {
      await relayRiskCouncil({
        mode,
        call: { fn: "cure", loanId: 4 },
        accessManagerId: "CAM",
        caller: "GCALLER",
        signTransaction: vi.fn(),
        ...base,
      });
      const arg = mockRelay.mock.calls.at(-1)![0];
      expect(arg.mode).toBe(mode);
      expect(arg.target).toBe("CREG");
      expect(arg.fn).toBe("cure");
      expect(scValToNative(arg.args[0])).toBe(4);
      expect(arg.accessManagerId).toBe("CAM");
    }
  });

  it("forwards schedule reads to readOperationSchedule", async () => {
    mockReadOperationSchedule.mockResolvedValue({
      operationId: "x",
      readyAt: 9,
    });
    const out = await readRiskCouncilSchedule({
      call: { fn: "set_default", loanId: 2 },
      accessManagerId: "CAM",
      caller: "GCALLER",
      ...base,
    });
    expect(out).toEqual({ operationId: "x", readyAt: 9 });
    const arg = mockReadOperationSchedule.mock.calls[0]![0];
    expect(arg.target).toBe("CREG");
    expect(arg.fn).toBe("set_default");
    expect(arg.caller).toBe("GCALLER");
  });
});

describe("riskCouncilReasonHash", () => {
  it("is the sha256 of the trimmed UTF-8 reason", async () => {
    const known =
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(await riskCouncilReasonHash("test")).toBe(known);
    expect(await riskCouncilReasonHash("  test \n")).toBe(known);
  });
});

describe("chain reads", () => {
  it("readLoanMoney maps bigint fields to strings", async () => {
    mockSimulateRead.mockResolvedValue({
      accrued_interest: 5n,
      carved_out: true,
      disbursed: 1000n,
      outstanding: 900n,
      repaid: 100n,
      written_down: 0n,
    });
    expect(await readLoanMoney({ ...base, loanId: 1 })).toEqual({
      accruedInterest: "5",
      carvedOut: true,
      disbursed: "1000",
      outstanding: "900",
      repaid: "100",
      writtenDown: "0",
    });
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("loan_money");
  });

  it("readLoanChainState decodes enum arrays and numbers", async () => {
    mockSimulateRead.mockResolvedValue({
      status: ["Default"],
      closure_reason: ["None"],
      current_rate: 145000,
      current_maturity_timestamp: 1_800_000_000n,
      interest_adjustment: -7n,
      written_down: 3n,
      carved_out: false,
    });
    expect(await readLoanChainState({ ...base, loanId: 1 })).toEqual({
      status: "Default",
      closureReason: "None",
      currentRate: 145000,
      currentMaturity: 1_800_000_000,
      interestAdjustment: "-7",
      writtenDown: "3",
      carvedOut: false,
    });
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("mutable_loan_data");
  });

  it("rejects an empty registry id and a missing field", async () => {
    await expect(
      readLoanMoney({ ...base, registryId: "", loanId: 1 }),
    ).rejects.toThrow(/registryId/);
    mockSimulateRead.mockResolvedValue({ status: ["Default"] });
    await expect(readLoanChainState({ ...base, loanId: 1 })).rejects.toThrow(
      /current_rate missing/,
    );
  });
});

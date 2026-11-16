// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { describe, it, expect, vi, beforeEach } from "vitest";
import { xdr } from "@stellar/stellar-sdk";

const { mockRelay, mockReadOperationSchedule } = vi.hoisted(() => ({
  mockRelay: vi.fn(),
  mockReadOperationSchedule: vi.fn(),
}));

vi.mock("./accessManager", () => ({
  relay: mockRelay,
  readOperationSchedule: mockReadOperationSchedule,
}));

import {
  decodeOperationArgs,
  executeScheduledOperation,
  operationArgsXdr,
  readScheduledOperation,
} from "./scheduledOperation";
import {
  encodeRiskCouncilArgs,
  riskCouncilArgsXdr,
  type RiskCouncilCall,
} from "./riskCouncil";
import {
  encodeSecurityRegistryArgs,
  securityRegistryArgsXdr,
  type SecurityRegistryCall,
} from "./securityRegistry";

const HASH = "cd".repeat(32);
const CALLS: SecurityRegistryCall[] = [
  {
    fn: "set_terms",
    loanId: 7,
    terms: {
      advanceRatioBps: 7000,
      marginCallRatioBps: 8000,
      curePeriod: 604800,
      priceStaleAfter: "86400",
      paymentTerm: "Lc",
      gracePeriod: 259200,
      defaultRate: 20000,
      attestationInterval: 2592000,
      inspectionInterval: 0,
      toleranceBps: 50,
      gradeToleranceBps: 25,
    },
  },
  { fn: "resolve_flag", recordId: 3, outcome: "Accepted", reasonHash: HASH },
  { fn: "release_with_consent", recordId: 3, consentHash: HASH },
];

const RISK_COUNCIL_CALLS: RiskCouncilCall[] = [
  { fn: "set_default", loanId: 3 },
  { fn: "cure", loanId: 3 },
  { fn: "amend_economics", loanId: 3, rateBps: 1450, maturity: 1_816_128_000 },
  { fn: "adjust_interest", loanId: 3, delta: "-1000000", reasonHash: HASH },
  { fn: "write_down", loanId: 3, amount: "5000000" },
  { fn: "close_defaulted", loanId: 3, reason: "OtherWriteDown" },
];

const base = {
  accessManagerId: "CAM",
  caller: "GCALLER",
  target: "CSEC",
  fn: "set_terms",
  rpcUrl: "https://rpc.test",
  networkPassphrase: "Test SDF Network ; September 2015",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("operation args round trip", () => {
  it.each(CALLS)("is byte identical for $fn", (call) => {
    const argsXdr = securityRegistryArgsXdr(call);
    const decoded = decodeOperationArgs(argsXdr);
    expect(decoded).toHaveLength(encodeSecurityRegistryArgs(call).length);
    expect(operationArgsXdr(decoded)).toBe(argsXdr);
  });

  it.each(RISK_COUNCIL_CALLS)("is byte identical for $fn", (call) => {
    const argsXdr = riskCouncilArgsXdr(call);
    const decoded = decodeOperationArgs(argsXdr);
    expect(decoded).toHaveLength(encodeRiskCouncilArgs(call).length);
    expect(operationArgsXdr(decoded)).toBe(argsXdr);
  });

  it("rejects a non-vector ScVal", () => {
    const scalar = xdr.ScVal.scvU32(1).toXDR("base64");
    expect(() => decodeOperationArgs(scalar)).toThrow(/not an ScVal vector/);
  });

  it("rejects garbage and empty input", () => {
    expect(() => decodeOperationArgs("!!not-base64!!")).toThrow();
    expect(() => decodeOperationArgs("")).toThrow();
  });
});

describe("scheduled operation calls", () => {
  const argsXdr = securityRegistryArgsXdr(CALLS[1]!);

  it("executes through relay with the decoded args", async () => {
    mockRelay.mockResolvedValue({ hash: "H" });
    const signTransaction = vi.fn();
    const result = await executeScheduledOperation({
      ...base,
      fn: "resolve_flag",
      argsXdr,
      signTransaction,
    });
    expect(result).toEqual({ hash: "H" });
    const params = mockRelay.mock.calls[0]![0];
    expect(params).toMatchObject({
      mode: "execute",
      accessManagerId: "CAM",
      caller: "GCALLER",
      target: "CSEC",
      fn: "resolve_flag",
      signTransaction,
    });
    expect(xdr.ScVal.scvVec(params.args).toXDR("base64")).toBe(argsXdr);
    expect(params.argsXdr).toBeUndefined();
  });

  it("reads the schedule with the decoded args", async () => {
    mockReadOperationSchedule.mockResolvedValue({
      operationId: "ab",
      readyAt: 5,
    });
    const result = await readScheduledOperation({
      ...base,
      fn: "resolve_flag",
      argsXdr,
    });
    expect(result).toEqual({ operationId: "ab", readyAt: 5 });
    const params = mockReadOperationSchedule.mock.calls[0]![0];
    expect(params).toMatchObject({ target: "CSEC", fn: "resolve_flag" });
    expect(xdr.ScVal.scvVec(params.args).toXDR("base64")).toBe(argsXdr);
  });

  it("does not call the network when the args are invalid", () => {
    expect(() => readScheduledOperation({ ...base, argsXdr: "" })).toThrow();
    expect(mockReadOperationSchedule).not.toHaveBeenCalled();
  });
});

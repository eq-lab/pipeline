// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import * as writedown from "./-risk-council-writedown";
import {
  CLOSE_GATE,
  buildWriteDownCall,
  closeExecuteGate,
  writeDownPrefill,
} from "./-risk-council-writedown";
import { chainStateRows } from "./-risk-council-shared";
import { loanState, STELLAR } from "./-riskCouncilFixtures";

describe("writeDownPrefill", () => {
  it("formats the raw chain outstanding verbatim", () => {
    expect(writeDownPrefill("18400000000000", STELLAR)).toBe("$1,840,000.00");
    expect(writeDownPrefill("12345678", STELLAR)).toBe("$1.2345678");
    expect(writeDownPrefill(undefined, STELLAR)).toBe("");
  });
});

describe("buildWriteDownCall", () => {
  it("converts the USD input to base units and rejects empty or zero", () => {
    expect(buildWriteDownCall(4, "$1,840,000.00")).toEqual({
      fn: "write_down",
      loanId: 4,
      amount: "18400000000000",
    });
    expect(buildWriteDownCall(4, "")).toBeNull();
    expect(buildWriteDownCall(4, "$0.00")).toBeNull();
    expect(buildWriteDownCall(null, "5")).toBeNull();
  });
});

describe("closeExecuteGate", () => {
  it("opens only when the chain outstanding is the string 0", () => {
    expect(closeExecuteGate("0")).toBeNull();
    expect(closeExecuteGate("1")).toBe(CLOSE_GATE);
    expect(closeExecuteGate("18400000000000")).toBe(CLOSE_GATE);
    expect(closeExecuteGate(undefined)).toBe(CLOSE_GATE);
  });
});

describe("chain state rows for resolution", () => {
  it("lists the seven rows including the closure reason", () => {
    const rows = chainStateRows(
      STELLAR,
      loanState({
        status: "Closed",
        closureReason: "Default",
        carvedOut: true,
      }),
      [
        "status",
        "outstanding",
        "disbursed",
        "repaid",
        "writtenDown",
        "pocket",
        "closure",
      ],
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Status (on chain)",
      "Outstanding principal",
      "Disbursed",
      "Principal repaid",
      "Written down",
      "Pocket opened",
      "Closure reason",
    ]);
    expect(rows.at(-1)?.value).toBe("Default");
    expect(rows.at(-2)?.value).toBe("Yes");
  });
});

describe("module surface", () => {
  it("keeps no mock constants, signers or close payload", () => {
    expect(
      Object.keys(writedown).filter((k) => /^MOCK_|SIGNER|PAYLOAD/i.test(k)),
    ).toEqual([]);
  });

  it("lists the docs' closure rows for Default and Other write-down", () => {
    expect(writedown.CLOSURE_TABLE).toEqual([
      {
        reason: "Default",
        label: "Default",
        who: "Risk Council only",
        delay: "24 hours",
      },
      {
        reason: "OtherWriteDown",
        label: "Other write-down",
        who: "Risk Council only",
        delay: "24 hours",
      },
    ]);
  });
});

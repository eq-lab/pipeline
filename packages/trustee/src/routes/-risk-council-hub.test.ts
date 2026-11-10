// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import { formatCallArgs, loanLinks } from "./-risk-council-hub";
import { STELLAR } from "./-riskCouncilFixtures";

const HASH = "ab".repeat(32);

describe("formatCallArgs", () => {
  it("prints the arguments verbatim per function", () => {
    expect(formatCallArgs({ fn: "set_default", loanId: 1 }, STELLAR)).toBe("—");
    expect(formatCallArgs({ fn: "cure", loanId: 1 }, STELLAR)).toBe("—");
    expect(
      formatCallArgs(
        {
          fn: "amend_economics",
          loanId: 1,
          rateBps: 1450,
          maturity: 1_797_292_800,
        },
        STELLAR,
      ),
    ).toBe("1450 bps · maturity 15 Dec 2026");
    expect(
      formatCallArgs(
        {
          fn: "adjust_interest",
          loanId: 1,
          delta: "-10005000000",
          reasonHash: HASH,
        },
        STELLAR,
      ),
    ).toBe("-$1,000.50 · reason hash ababababab…");
    expect(
      formatCallArgs(
        { fn: "write_down", loanId: 1, amount: "18400000000000" },
        STELLAR,
      ),
    ).toBe("$1,840,000.00");
    expect(
      formatCallArgs(
        { fn: "close_defaulted", loanId: 1, reason: "OtherWriteDown" },
        STELLAR,
      ),
    ).toBe("OtherWriteDown");
  });
});

describe("loanLinks", () => {
  it("offers declare default and amend for Performing and WatchList", () => {
    for (const status of ["Performing", "WatchList"]) {
      expect(loanLinks(status)).toEqual([
        { label: "Declare default", route: "escalate" },
        { label: "Amend economics", route: "reterm" },
      ]);
    }
  });

  it("offers resolve default and amend for Default", () => {
    expect(loanLinks("Default")).toEqual([
      { label: "Resolve default", route: "writedown" },
      { label: "Amend economics", route: "reterm" },
    ]);
  });

  it("offers nothing for Closed or other statuses", () => {
    expect(loanLinks("Closed")).toEqual([]);
    expect(loanLinks("Approved")).toEqual([]);
  });
});

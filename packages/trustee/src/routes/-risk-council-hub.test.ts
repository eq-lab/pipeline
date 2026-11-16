// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import { fromServed } from "./-risk-council-pending";
import {
  formatPendingArgs,
  HUB_FOOTNOTE,
  HUB_NO_ROLE,
  loanLinks,
} from "./-risk-council-hub";
import { STELLAR, loanRegistryOp, minterOp } from "./-riskCouncilFixtures";

const HASH = "ab".repeat(32);

function item(fn: Parameters<typeof loanRegistryOp>[0], args: unknown[]) {
  return fromServed(loanRegistryOp(fn, { args }));
}

describe("formatPendingArgs", () => {
  it("prints the shared argument rows, a dash when there are none", () => {
    expect(formatPendingArgs(item("set_default", [1]), STELLAR)).toBe("—");
    expect(formatPendingArgs(item("cure", [1]), STELLAR)).toBe("—");
    expect(
      formatPendingArgs(item("write_down", [1, "18400000000000"]), STELLAR),
    ).toBe("Amount: $1,840,000.00");
    expect(
      formatPendingArgs(
        item("close_defaulted", [1, ["OtherWriteDown"]]),
        STELLAR,
      ),
    ).toBe("Closure reason: Other write-down");
    expect(
      formatPendingArgs(
        item("adjust_interest", [1, "-10005000000", HASH]),
        STELLAR,
      ),
    ).toBe("Delta: -$1,000.50 · Reason hash: ababababab…");
  });

  it("falls back to the raw JSON when the arguments do not decode", () => {
    expect(formatPendingArgs(item("write_down", [1, 5]), STELLAR)).toBe(
      "Arguments: [1,5]",
    );
  });

  it("prints the repayment of a reverse_repay", () => {
    expect(
      formatPendingArgs(fromServed(minterOp({ args: [1, 4, HASH] })), STELLAR),
    ).toBe("Repayment: #4 · Reference hash: ababababab…");
  });
});

describe("loanLinks", () => {
  it("offers declare default and amend for Performing and WatchList", () => {
    for (const status of ["Performing", "WatchList"]) {
      expect(loanLinks(status)).toEqual([
        { label: "Declare default", route: "escalate" },
        { label: "Amend economics", route: "reterm" },
        { label: "Security", route: "security" },
      ]);
    }
  });

  it("offers resolve default and amend for Default", () => {
    expect(loanLinks("Default")).toEqual([
      { label: "Resolve default", route: "writedown" },
      { label: "Amend economics", route: "reterm" },
      { label: "Security", route: "security" },
    ]);
  });

  it("offers only Security for other open statuses and nothing for Closed", () => {
    expect(loanLinks("Closed")).toEqual([]);
    expect(loanLinks("Approved")).toEqual([
      { label: "Security", route: "security" },
    ]);
  });
});

describe("hub copy", () => {
  it("names the inspector panel in the footnote and drops the scheduler-only line", () => {
    expect(HUB_FOOTNOTE).toMatch(/Inspector panel changes are not tied/);
    expect(HUB_FOOTNOTE).toMatch(/open the Inspector panel/);
    expect(HUB_NO_ROLE).toBe(
      "Risk Council actions belong to the Risk Council.",
    );
  });
});

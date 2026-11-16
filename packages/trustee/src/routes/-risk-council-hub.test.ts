// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import {
  formatCallArgs,
  HUB_FOOTNOTE,
  HUB_NO_ROLE,
  loanLinks,
} from "./-risk-council-hub";
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

describe("security calls", () => {
  const terms = {
    advanceRatioBps: 7000,
    marginCallRatioBps: 8250,
    curePeriod: "604800",
    priceStaleAfter: "86400",
    paymentTerm: "Da",
    gracePeriod: "0",
    defaultRate: 20000,
    attestationInterval: "0",
    inspectionInterval: "0",
    toleranceBps: 50,
    gradeToleranceBps: 25,
  } as const;

  it("prints terms, flag resolution, release and inspector arguments", () => {
    expect(formatCallArgs({ fn: "set_terms", loanId: 1, terms }, STELLAR)).toBe(
      "advance 70% · margin call 82.5%",
    );
    expect(
      formatCallArgs(
        {
          fn: "resolve_flag",
          recordId: 12,
          outcome: "TopUpRequired",
          reasonHash: HASH,
        },
        STELLAR,
      ),
    ).toBe("TopUpRequired · record #12");
    expect(
      formatCallArgs(
        { fn: "release_with_consent", recordId: 3, consentHash: HASH },
        STELLAR,
      ),
    ).toBe("record #3 · consent hash ababababab…");
    expect(
      formatCallArgs({ fn: "set_inspectors", inspectors: ["GA"] }, STELLAR),
    ).toBe("1 inspector");
    expect(
      formatCallArgs(
        { fn: "set_inspectors", inspectors: ["GA", "GB", "GC"] },
        STELLAR,
      ),
    ).toBe("3 inspectors");
  });

  it("prints the repayment number for a reverse_repay", () => {
    expect(
      formatCallArgs(
        { fn: "reverse_repay", loanId: 1, repaymentId: 4, refHash: HASH },
        STELLAR,
      ),
    ).toBe("repayment #4");
  });

  it("names the inspector panel in the footnote and drops the scheduler-only line", () => {
    expect(HUB_FOOTNOTE).toMatch(/Inspector panel changes are not tied/);
    expect(HUB_FOOTNOTE).toMatch(/open the Inspector panel/);
    expect(HUB_NO_ROLE).toBe(
      "Risk Council actions belong to the Risk Council.",
    );
  });
});

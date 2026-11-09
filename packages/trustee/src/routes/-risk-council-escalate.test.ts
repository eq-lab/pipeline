// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import type { TopConcentration } from "@/api/useLoanBook";
import * as escalate from "./-risk-council-escalate";
import {
  buildCollateralLabel,
  buildConcentration,
  escalateEligibility,
  formatCcrLine,
  formatFacilityLine,
  nextCcrAlertPct,
} from "./-risk-council-escalate";
import { chainStateRows } from "./-risk-council-shared";
import { loanState, STELLAR } from "./-riskCouncilFixtures";

describe("nextCcrAlertPct", () => {
  it("returns the next protocol threshold below the CCR", () => {
    expect(nextCcrAlertPct(11_400)).toBe(110);
    expect(nextCcrAlertPct(12_500)).toBe(120);
    expect(nextCcrAlertPct(13_000)).toBe(120);
  });

  it("returns null above 130%, at or below 110% and for bad input", () => {
    expect(nextCcrAlertPct(13_500)).toBeNull();
    expect(nextCcrAlertPct(11_000)).toBeNull();
    expect(nextCcrAlertPct(null)).toBeNull();
    expect(nextCcrAlertPct(Number.NaN)).toBeNull();
  });
});

describe("formatCcrLine", () => {
  it("formats the alert clause only when a threshold remains", () => {
    expect(formatCcrLine(11_400)).toBe("114% — next alert at 110%");
    expect(formatCcrLine(10_500)).toBe("105%");
    expect(formatCcrLine(null)).toBe("—");
  });
});

describe("formatFacilityLine", () => {
  it("formats served amounts as full USD and dashes missing ones", () => {
    expect(formatFacilityLine("2300000.000000", "1840000.000000")).toBe(
      "$2,300,000 / $1,840,000",
    );
    expect(formatFacilityLine(null, null)).toBe("— / —");
  });
});

describe("buildCollateralLabel", () => {
  it("uses the served 7-day basis and omits it when unserved", () => {
    expect(buildCollateralLabel("Coffee", "-0.18")).toBe(
      "Collateral (coffee −18% 7d)",
    );
    expect(buildCollateralLabel("Copper Concentrate", "0.05")).toBe(
      "Collateral (copper concentrate +5% 7d)",
    );
    expect(buildCollateralLabel("Coffee", null)).toBe("Collateral");
  });
});

describe("buildConcentration", () => {
  const top: TopConcentration = { commodity: "Coffee", share: "0.0390" };

  it("renders the share only for this loan's commodity", () => {
    expect(buildConcentration("Coffee", top)).toEqual({
      label: "Coffee concentration",
      value: "3.9%",
    });
    expect(buildConcentration("coffee", top).value).toBe("3.9%");
    expect(buildConcentration("Lithium", top).value).toBe("—");
    expect(buildConcentration("Coffee", null).value).toBe("—");
  });
});

describe("escalateEligibility", () => {
  it("enables Performing and WatchList", () => {
    expect(escalateEligibility("Performing").kind).toBe("eligible");
    expect(escalateEligibility("WatchList").kind).toBe("eligible");
  });

  it("points a Default loan to the resolution page", () => {
    expect(escalateEligibility("Default").kind).toBe("default");
  });

  it("blocks Closed and Approved and waits for an unread status", () => {
    expect(escalateEligibility("Closed")).toEqual({
      kind: "unavailable",
      note: "Not available for a Closed loan.",
    });
    expect(escalateEligibility("Approved").kind).toBe("unavailable");
    expect(escalateEligibility(null).kind).toBe("unknown");
  });
});

describe("chain state rows", () => {
  const keys = ["status", "outstanding", "writtenDown", "pocket"] as const;

  it("shows the pocket as Yes or No from carved_out", () => {
    const yes = chainStateRows(STELLAR, loanState({ carvedOut: true }), keys);
    const no = chainStateRows(STELLAR, loanState({ carvedOut: false }), keys);
    expect(yes.find((r) => r.label === "Pocket opened")?.value).toBe("Yes");
    expect(no.find((r) => r.label === "Pocket opened")?.value).toBe("No");
  });

  it("formats raw chain amounts and dashes everything when unread", () => {
    const rows = chainStateRows(
      STELLAR,
      loanState({ status: "Default", outstanding: "18400000000000" }),
      keys,
    );
    expect(rows[0]).toEqual({ label: "Status (on chain)", value: "Default" });
    expect(rows[1]).toEqual({
      label: "Outstanding principal",
      value: "$1,840,000.00",
    });
    expect(
      chainStateRows(STELLAR, undefined, keys).map((r) => r.value),
    ).toEqual(["—", "—", "—", "—"]);
  });

  it("formats Principal repaid from the raw chain value", () => {
    const rows = chainStateRows(STELLAR, loanState({ repaid: "100000000" }), [
      "repaid",
    ]);
    expect(rows[0]).toEqual({ label: "Principal repaid", value: "$10.00" });
  });
});

describe("module surface", () => {
  it("exports no mock constants", () => {
    expect(Object.keys(escalate).filter((k) => k.startsWith("MOCK_"))).toEqual(
      [],
    );
  });
});

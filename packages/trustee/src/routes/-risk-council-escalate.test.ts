// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import type { TopConcentration } from "@/api/useLoanBook";
import * as escalate from "./-risk-council-escalate";
import {
  buildConcentration,
  buildLedgerSecurity,
  escalateEligibility,
  formatFacilityLine,
} from "./-risk-council-escalate";
import { chainStateRows } from "./-risk-council-shared";
import { loanState, securityResult, STELLAR } from "./-riskCouncilFixtures";

describe("formatFacilityLine", () => {
  it("formats served amounts as full USD and dashes missing ones", () => {
    expect(formatFacilityLine("2300000.000000", "1840000.000000")).toBe(
      "$2,300,000 / $1,840,000",
    );
    expect(formatFacilityLine(null, null)).toBe("— / —");
  });
});

describe("buildLedgerSecurity", () => {
  it("builds the value, LTV line, ratios and tone from the served security", () => {
    expect(buildLedgerSecurity(securityResult())).toEqual({
      value: "$2,106,000",
      ltvLine: "81.3% — margin call at 85%",
      ltvTone: "attention",
      ratios: "80% / 85%",
      priceStale: false,
    });
  });

  it("is null when not configured or when no terms are set", () => {
    expect(
      buildLedgerSecurity(
        securityResult({ data: undefined, notConfigured: true }),
      ),
    ).toBeNull();
    expect(
      buildLedgerSecurity(securityResult({ data: { terms: null } })),
    ).toBeNull();
  });

  it("shows a loading or error marker, not a bare dash", () => {
    const marker = (text: string) => ({
      value: text,
      ltvLine: text,
      ltvTone: "neutral",
      ratios: text,
      priceStale: false,
    });
    expect(
      buildLedgerSecurity(securityResult({ data: undefined, isLoading: true })),
    ).toEqual(marker("Loading…"));
    expect(
      buildLedgerSecurity(
        securityResult({ data: undefined, error: new Error("boom") }),
      ),
    ).toEqual(marker("Couldn't load"));
  });

  it("does not throw on a partial 200 and flags a stale price", () => {
    expect(() =>
      buildLedgerSecurity(securityResult({ data: {} })),
    ).not.toThrow();
    const stale = buildLedgerSecurity(
      securityResult({
        data: {
          terms: { advance_ratio_bps: 8000, margin_call_ratio_bps: 8500 },
          prices: { price_stale: true },
          margin_call: { open: true },
        },
      }),
    );
    expect(stale?.priceStale).toBe(true);
    expect(stale?.ltvTone).toBe("negative");
    expect(stale?.value).toBe("—");
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

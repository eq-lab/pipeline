/**
 * Unit tests for the Risk Council — Write-down close presenter's pure helpers
 * (`-risk-council-writedown.ts`, issue #782, flow 12). All pure — no DOM.
 */
import { describe, it, expect } from "vitest";
import { formatLoanLabel } from "./-risk-council-writedown";

describe("formatLoanLabel", () => {
  it("joins originator and commodity with an em dash", () => {
    expect(formatLoanLabel("Delta Commodities", "Coffee")).toBe(
      "Delta Commodities — Coffee",
    );
  });

  it('renders "—" for missing parts (never fabricated)', () => {
    expect(formatLoanLabel(null, "Coffee")).toBe("— — Coffee");
    expect(formatLoanLabel("Delta", undefined)).toBe("Delta — —");
  });
});

import { describe, it, expect } from "vitest";
import { percentToBps, MAX_RATE_BPS } from "./rateUnits";

describe("percentToBps (#1625)", () => {
  it("converts a percent with decimals to integer bps exactly", () => {
    expect(percentToBps("14.5")).toBe(1450);
    expect(percentToBps("14")).toBe(1400);
    expect(percentToBps("14.05")).toBe(1405);
    expect(percentToBps("0.01")).toBe(1);
    expect(percentToBps(" 7.25 ")).toBe(725);
    expect(percentToBps("100")).toBe(MAX_RATE_BPS);
  });

  it("rejects more than two decimals, zero, negatives, out-of-range and junk", () => {
    for (const bad of [
      "14.555",
      "0",
      "0.00",
      "-1",
      "100.01",
      "1e2",
      "abc",
      "",
      "14,5",
      ".5",
    ]) {
      expect(percentToBps(bad), bad).toBeNull();
    }
  });
});

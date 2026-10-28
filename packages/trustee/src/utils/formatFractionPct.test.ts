import { describe, expect, it } from "vitest";
import { formatFractionPct } from "./formatFractionPct";

describe("formatFractionPct", () => {
  it("formats a decimal fraction as a one-decimal percent", () => {
    expect(formatFractionPct("0.0430")).toBe("4.3%");
    expect(formatFractionPct("0.5")).toBe("50.0%");
    expect(formatFractionPct("0")).toBe("0.0%");
  });

  it("renders an em dash for null, undefined and non-numeric input", () => {
    expect(formatFractionPct(null)).toBe("—");
    expect(formatFractionPct(undefined)).toBe("—");
    expect(formatFractionPct("abc")).toBe("—");
    expect(formatFractionPct("")).toBe("—");
  });
});

import { describe, it, expect } from "vitest";
import { formatUnits4 } from "./formatUnits4";

describe("formatUnits4", () => {
  it("truncates instead of rounding", () => {
    expect(formatUnits4(1042199999999999999n, 18)).toBe("1.0421");
  });

  it("zero-pads short fractions", () => {
    expect(formatUnits4(10400000n, 7)).toBe("1.0400");
  });

  it("pads integer-only values", () => {
    expect(formatUnits4(2_000_000_000_000_000_000n, 18)).toBe("2.0000");
  });
});

// spec: docs/frontend/trustee-flows.md#disburse-1898
import { describe, expect, it } from "vitest";
import {
  parseExactAmount,
  rawToDecimal,
  SAC_DECIMALS,
  usdInputToSacBaseUnits,
} from "./stellarSacUnits";

describe("rawToDecimal", () => {
  it.each([
    ["10000000", "1"],
    ["12345678", "1.2345678"],
    ["5", "0.0000005"],
    ["12345670", "1.234567"],
    ["0", "0"],
  ])("renders %s at 7 dp as %s", (raw, expected) => {
    expect(rawToDecimal(raw, SAC_DECIMALS)).toBe(expected);
  });

  it.each([
    ["1000000", "1"],
    ["1234567", "1.234567"],
    ["5", "0.000005"],
    ["0", "0"],
  ])("renders %s at 6 dp as %s", (raw, expected) => {
    expect(rawToDecimal(raw, 6)).toBe(expected);
  });
});

describe("parseExactAmount", () => {
  it("accepts seven decimals at 7 dp and rejects them at 6 dp", () => {
    expect(parseExactAmount("1.1234567", 7)).toBe(11234567n);
    expect(parseExactAmount("1.1234567", 6)).toBeNull();
  });

  it.each(["0", "1.", ".5", "$1", "1,000"])("rejects %s", (input) => {
    expect(parseExactAmount(input, 7)).toBeNull();
  });

  it("accepts a trimmed input", () => {
    expect(parseExactAmount(" 12.5 ", 7)).toBe(125000000n);
  });
});

describe("usdInputToSacBaseUnits", () => {
  it("strips separators and truncates to 7 dp", () => {
    expect(usdInputToSacBaseUnits("$1,000.123456789")).toBe("10001234567");
  });

  it("accepts a leading-dot fraction", () => {
    expect(usdInputToSacBaseUnits(".5")).toBe("5000000");
  });

  it("returns null for zero", () => {
    expect(usdInputToSacBaseUnits("0")).toBeNull();
  });
});

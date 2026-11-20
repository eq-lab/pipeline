// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect } from "vitest";
import {
  bpsToPercentText,
  defaultRateToPercentText,
  durationToSeconds,
  formatServedDuration,
  percentToBpsStrict,
  percentToDefaultRate,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  secondsToUnitText,
} from "./securityTermsUnits";

describe("percentToBpsStrict", () => {
  it("converts percent with at most two decimals to bps and allows zero", () => {
    expect(percentToBpsStrict("70")).toBe(7000);
    expect(percentToBpsStrict(" 82.5 ")).toBe(8250);
    expect(percentToBpsStrict("0.25")).toBe(25);
    expect(percentToBpsStrict("0")).toBe(0);
  });

  it("rejects bad shapes, a third decimal and absurd values", () => {
    for (const bad of ["", "abc", "-1", "1.234", "1e2", "1,5", "1000.01"]) {
      expect(percentToBpsStrict(bad)).toBeNull();
    }
    expect(percentToBpsStrict("1000")).toBe(100_000);
  });
});

describe("percentToDefaultRate", () => {
  it("scales percent by 10 000 (1e6 = 100%) with up to four decimals", () => {
    expect(percentToDefaultRate("2")).toBe(20_000);
    expect(percentToDefaultRate("0.0001")).toBe(1);
    expect(percentToDefaultRate("12.3456")).toBe(123_456);
  });

  it("rejects a fifth decimal, junk and u32 overflow", () => {
    expect(percentToDefaultRate("0.00001")).toBeNull();
    expect(percentToDefaultRate("x")).toBeNull();
    expect(percentToDefaultRate("429497")).toBeNull();
    expect(percentToDefaultRate("4294")).toBe(42_940_000);
  });
});

describe("durationToSeconds", () => {
  it("converts days and hours to integer seconds", () => {
    expect(durationToSeconds("7", SECONDS_PER_DAY)).toBe("604800");
    expect(durationToSeconds("24", SECONDS_PER_HOUR)).toBe("86400");
    expect(durationToSeconds("0", SECONDS_PER_DAY)).toBe("0");
    expect(durationToSeconds("1.5", SECONDS_PER_DAY)).toBe("129600");
  });

  it("rejects fractions that are not whole seconds, junk and u64 overflow", () => {
    expect(durationToSeconds("0.0000001", SECONDS_PER_DAY)).toBeNull();
    expect(durationToSeconds("1.00001", SECONDS_PER_HOUR)).toBeNull();
    expect(durationToSeconds("-1", SECONDS_PER_DAY)).toBeNull();
    expect(durationToSeconds("", SECONDS_PER_DAY)).toBeNull();
    expect(durationToSeconds("9".repeat(30), SECONDS_PER_DAY)).toBeNull();
  });
});

describe("prefill text", () => {
  it("formats bps and default rate without trailing zeros", () => {
    expect(bpsToPercentText(7000)).toBe("70");
    expect(bpsToPercentText(8250)).toBe("82.5");
    expect(bpsToPercentText(25)).toBe("0.25");
    expect(defaultRateToPercentText(20_000)).toBe("2");
    expect(defaultRateToPercentText(123_456)).toBe("12.3456");
  });

  it("round-trips whole and exact fractional units, else gives null", () => {
    expect(secondsToUnitText("604800", SECONDS_PER_DAY)).toBe("7");
    expect(secondsToUnitText("129600", SECONDS_PER_DAY)).toBe("1.5");
    expect(secondsToUnitText("0", SECONDS_PER_HOUR)).toBe("0");
    expect(secondsToUnitText("1", SECONDS_PER_DAY)).toBeNull();
    expect(secondsToUnitText("x", SECONDS_PER_DAY)).toBeNull();
  });

  it("formats served durations", () => {
    expect(formatServedDuration("604800")).toBe("7 d");
    expect(formatServedDuration("7200")).toBe("2 h");
    expect(formatServedDuration("90")).toBe("90 s");
    expect(formatServedDuration("0")).toBe("0 s");
    expect(formatServedDuration(undefined)).toBe("—");
  });
});

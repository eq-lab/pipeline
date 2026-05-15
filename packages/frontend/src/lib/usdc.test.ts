/**
 * Unit tests for `src/lib/usdc.ts`.
 *
 * Covers:
 *   - `parseUsdc` — round-trips, invalid input, undefined decimals, negatives.
 *   - `formatUsdc` — round-trips, undefined decimals sentinel, Intl formatting.
 *   - `formatUsdcCurrency` — "$" prefix, undefined decimals sentinel.
 */
import { describe, it, expect } from "vitest";
import { parseUsdc, formatUsdc, formatUsdcCurrency } from "./usdc";

const D6 = 6; // standard USDC decimals

describe("parseUsdc", () => {
  it("parses a whole-number string at 6 decimals", () => {
    expect(parseUsdc("1000", D6)).toBe(1_000_000_000n);
  });

  it("parses a decimal string at 6 decimals", () => {
    expect(parseUsdc("1000.50", D6)).toBe(1_000_500_000n);
  });

  it("returns 0n for empty string", () => {
    expect(parseUsdc("", D6)).toBe(0n);
  });

  it("returns 0n for whitespace-only string", () => {
    expect(parseUsdc("   ", D6)).toBe(0n);
  });

  it("returns 0n for undefined decimals", () => {
    expect(parseUsdc("1000", undefined)).toBe(0n);
  });

  it("returns 0n for NaN-like input", () => {
    expect(parseUsdc("abc", D6)).toBe(0n);
  });

  it("returns 0n for malformed decimal input", () => {
    expect(parseUsdc("1.2.3", D6)).toBe(0n);
  });

  it("clamps negative values to 0n", () => {
    expect(parseUsdc("-500", D6)).toBe(0n);
  });

  it("round-trips: parseUsdc(formatUsdc(value)) === value", () => {
    const value = 1_000_000_000n; // 1,000 USDC
    const formatted = formatUsdc(value, D6).replace(/,/g, "");
    expect(parseUsdc(formatted, D6)).toBe(value);
  });
});

describe("formatUsdc", () => {
  it("formats 1,000 USDC (6 decimals) to '1,000.00'", () => {
    expect(formatUsdc(1_000_000_000n, D6)).toBe("1,000.00");
  });

  it("formats 0.50 USDC to '0.50'", () => {
    expect(formatUsdc(500_000n, D6)).toBe("0.50");
  });

  it("formats 0 to '0.00'", () => {
    expect(formatUsdc(0n, D6)).toBe("0.00");
  });

  it("returns '—' when decimals is undefined", () => {
    expect(formatUsdc(1_000_000_000n, undefined)).toBe("—");
  });

  it("always produces exactly 2 fraction digits", () => {
    // 1,000,001 / 10^6 = 1.000001 → rounds to "1.00"
    const result = formatUsdc(1_000_001n, D6);
    const [, fraction] = result.split(".");
    expect(fraction).toHaveLength(2);
  });
});

describe("formatUsdcCurrency", () => {
  it("prefixes formatUsdc with '$'", () => {
    expect(formatUsdcCurrency(1_000_000_000n, D6)).toBe("$1,000.00");
  });

  it("returns '—' when decimals is undefined", () => {
    expect(formatUsdcCurrency(1_000_000_000n, undefined)).toBe("—");
  });

  it("formats 250 USDC as '$250.00'", () => {
    expect(formatUsdcCurrency(250_000_000n, D6)).toBe("$250.00");
  });
});

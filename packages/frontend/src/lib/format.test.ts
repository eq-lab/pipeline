/**
 * Unit tests for `src/lib/format.ts`.
 *
 * Covers:
 *   - `formatTokenAmount` — 6-dp USDC, 18-dp PLUSD, zero, large bigint, string input.
 *   - `formatActivityTime` — shape-only assertion (TZ-independent), invalid input.
 */
import { describe, it, expect } from "vitest";
import {
  formatTokenAmount,
  formatActivityTime,
  formatBigintCurrency,
  formatRawDecimalUSD,
} from "./format";

describe("formatTokenAmount", () => {
  it("formats 1 USDC (6 decimals) — 1_000_000n → '1.00'", () => {
    expect(formatTokenAmount(1_000_000n, 6)).toBe("1.00");
  });

  it("formats 1,000 USDC (6 decimals) — 1_000_000_000n → '1,000.00'", () => {
    expect(formatTokenAmount(1_000_000_000n, 6)).toBe("1,000.00");
  });

  it("formats 1,000 PLUSD (18 decimals) — 1_000_000_000_000_000_000_000n → '1,000.00'", () => {
    expect(formatTokenAmount(1_000_000_000_000_000_000_000n, 18)).toBe(
      "1,000.00",
    );
  });

  it("formats 0 → '0.00'", () => {
    expect(formatTokenAmount(0n, 6)).toBe("0.00");
  });

  it("accepts a decimal bigint string as raw input", () => {
    expect(formatTokenAmount("1000000", 6)).toBe("1.00");
  });

  it("accepts a large string raw input", () => {
    expect(formatTokenAmount("1000000000000000000000", 18)).toBe("1,000.00");
  });

  it("always produces exactly 2 fraction digits", () => {
    const result = formatTokenAmount(1_000_001n, 6);
    const [, fraction] = result.split(".");
    expect(fraction).toHaveLength(2);
  });
});

describe("formatActivityTime", () => {
  it("returns a string matching 'Mon DD, H:MM AM/PM' shape", () => {
    // Use a well-known UTC date; the exact formatted string varies by timezone
    // so we only assert on the shape.
    const result = formatActivityTime("2026-04-17T14:17:00Z");
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/);
  });

  it("returns '—' for an unparseable string", () => {
    expect(formatActivityTime("not-a-date")).toBe("—");
  });

  it("returns '—' for an empty string", () => {
    expect(formatActivityTime("")).toBe("—");
  });
});

describe("formatRawDecimalUSD — sign follows the rendered 2dp value (#1194)", () => {
  it("dust-level negative rounds to unsigned $0.00", () => {
    expect(formatRawDecimalUSD("-40000", 7, { signed: true })).toBe("$0.00");
  });

  it("dust-level positive rounds to unsigned $0.00 even when signed", () => {
    expect(formatRawDecimalUSD("40000", 7, { signed: true })).toBe("$0.00");
  });

  it("keeps the suffix on an unsigned zero", () => {
    expect(
      formatRawDecimalUSD("-40000", 7, { signed: true, suffix: "unrealized" }),
    ).toBe("$0.00 unrealized");
  });

  it("real negative renders -$…", () => {
    expect(formatRawDecimalUSD("-12300000", 7, { signed: true })).toBe(
      "-$1.23",
    );
  });

  it("positive renders +$… when signed", () => {
    expect(formatRawDecimalUSD("12300000", 7, { signed: true })).toBe("+$1.23");
  });

  it("positive renders $… without a plus when unsigned", () => {
    expect(formatRawDecimalUSD("12300000", 7)).toBe("$1.23");
  });

  it("exact zero renders $0.00", () => {
    expect(formatRawDecimalUSD("0", 7, { signed: true })).toBe("$0.00");
  });

  it("null / undefined / non-numeric render $0.00", () => {
    expect(formatRawDecimalUSD(null, 7, { signed: true })).toBe("$0.00");
    expect(formatRawDecimalUSD(undefined, 7, { signed: true })).toBe("$0.00");
    expect(formatRawDecimalUSD("abc", 7, { signed: true })).toBe("$0.00");
  });
});

describe("formatBigintCurrency — never renders -$0.00 (#1194)", () => {
  it("dust-level negative rounds to unsigned $0.00", () => {
    expect(formatBigintCurrency(-40_000n, 7)).toBe("$0.00");
  });

  it("real negative renders -$…", () => {
    expect(formatBigintCurrency(-12_300_000n, 7)).toBe("-$1.23");
  });

  it("positive renders $…", () => {
    expect(formatBigintCurrency(12_300_000n, 7)).toBe("$1.23");
  });

  it("undefined and 0n render $0.00", () => {
    expect(formatBigintCurrency(undefined, 7)).toBe("$0.00");
    expect(formatBigintCurrency(0n, 7)).toBe("$0.00");
  });
});

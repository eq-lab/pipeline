/**
 * Unit tests for `src/lib/format.ts`.
 *
 * Covers:
 *   - `formatTokenAmount` — 6-dp USDC, 18-dp PLUSD, zero, large bigint, string input.
 *   - `formatActivityTime` — shape-only assertion (TZ-independent), invalid input.
 */
import { describe, it, expect } from "vitest";
import { formatTokenAmount, formatActivityTime } from "./format";

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

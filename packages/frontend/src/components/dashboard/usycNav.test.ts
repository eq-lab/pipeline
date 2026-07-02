/**
 * Tests for `convertUsycToUsdc` (USYC NAV seam).
 *
 * These tests lock the 1:1 identity contract so that a future NAV change is a
 * deliberate, tested edit rather than a silent regression.
 */
import { describe, it, expect } from "vitest";
import { convertUsycToUsdc } from "./usycNav";

describe("convertUsycToUsdc (1:1 identity stub)", () => {
  it("returns the input unchanged (1:1)", () => {
    expect(convertUsycToUsdc(0n)).toBe(0n);
    expect(convertUsycToUsdc(10_000_000n)).toBe(10_000_000n);
    expect(convertUsycToUsdc(431_400_000_000_000n)).toBe(431_400_000_000_000n);
  });

  it("returns 0n for 0n input", () => {
    expect(convertUsycToUsdc(0n)).toBe(0n);
  });

  it("preserves large bigint values without loss", () => {
    const large = BigInt("99999999999999999999");
    expect(convertUsycToUsdc(large)).toBe(large);
  });
});

/**
 * Tests for `src/utils/truncateAddress.ts`.
 *
 * Covers:
 *   - EVM addresses (0x-prefixed, 42 chars) → 6+4 form.
 *   - Stellar addresses (G…, 56 chars) → 6+4 form.
 *   - Short addresses (≤ 12 chars) → returned as-is.
 *   - Empty string → returned as-is.
 */
import { describe, it, expect } from "vitest";
import { truncateAddress } from "./truncateAddress";

describe("truncateAddress", () => {
  it("truncates a 42-char EVM address to 0xXXXX…XXXX form", () => {
    const addr = "0x7a3f2b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f3f";
    expect(truncateAddress(addr)).toBe("0x7a3f…9f3f");
  });

  it("truncates a 56-char Stellar G… strkey to GABCDE…WXYZ form", () => {
    // 56-char Stellar address
    const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
    const result = truncateAddress(addr);
    // Should be 6 chars + ellipsis + 4 chars = 11 display chars
    expect(result).toHaveLength(11); // 6 + 1 (ellipsis) + 4
    // First 6 = "GABCDE", last 4 = "TUVW"
    expect(result).toBe("GABCDE…TUVW");
  });

  it("returns address as-is when length ≤ 12", () => {
    expect(truncateAddress("0x1234567890")).toBe("0x1234567890"); // 12 chars → as-is
    expect(truncateAddress("short")).toBe("short");
    // 13 chars → truncated (first 6 + ellipsis + last 4)
    expect(truncateAddress("0x12345678901")).toBe("0x1234…8901");
  });

  it("returns empty string as-is", () => {
    expect(truncateAddress("")).toBe("");
  });

  it("truncates exactly at the 12-char boundary", () => {
    // 12-char string → returned as-is
    expect(truncateAddress("abcdefghijkl")).toBe("abcdefghijkl");
    // 13-char string → truncated
    expect(truncateAddress("abcdefghijklm")).toBe("abcdef…jklm");
  });

  it("preserves the 6+4 slice independent of address format", () => {
    const evm = "0x8493000000000000000000000000000000003b92";
    expect(truncateAddress(evm)).toBe("0x8493…3b92");
  });
});

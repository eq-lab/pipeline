/**
 * Unit tests for the Cash Management presenter's pure helpers
 * (`-cash-management.ts`, issue #943). All pure — no DOM, no query layer.
 */
import { describe, it, expect } from "vitest";
import { truncateStrkey, formatRelativeAge } from "./-cash-management";

describe("truncateStrkey", () => {
  it("keeps the first 4 + last 4 with an ellipsis for a full Strkey", () => {
    expect(truncateStrkey("GABCD1234567890WXYZ")).toBe("GABC…WXYZ");
  });

  it("renders short addresses whole", () => {
    expect(truncateStrkey("GABC12")).toBe("GABC12");
  });

  it('returns "—" for missing/empty (never fabricated)', () => {
    expect(truncateStrkey(null)).toBe("—");
    expect(truncateStrkey(undefined)).toBe("—");
    expect(truncateStrkey("")).toBe("—");
  });
});

describe("formatRelativeAge", () => {
  const now = 1_800_000_000;

  it('formats sub-minute as "just now"', () => {
    expect(formatRelativeAge(now - 30, now)).toBe("just now");
  });

  it("formats minutes / hours / days", () => {
    expect(formatRelativeAge(now - 5 * 60, now)).toBe("5m ago");
    expect(formatRelativeAge(now - 3 * 3600, now)).toBe("3h ago");
    expect(formatRelativeAge(now - 2 * 86_400, now)).toBe("2d ago");
  });

  it("clamps a future timestamp to just now (never negative)", () => {
    expect(formatRelativeAge(now + 100, now)).toBe("just now");
  });

  it('returns "—" for a missing/invalid stamp', () => {
    expect(formatRelativeAge(null, now)).toBe("—");
    expect(formatRelativeAge(undefined, now)).toBe("—");
    expect(formatRelativeAge(NaN, now)).toBe("—");
  });
});

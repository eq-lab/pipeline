/**
 * Unit tests for the Cash Management presenter's pure helpers
 * (`-cash-management.ts`, issue #943). All pure — no DOM, no query layer.
 */
import { describe, it, expect, vi } from "vitest";

// The presenter statically imports the balance/address hooks, whose module
// graph reaches `@stellar/freighter-api` (CommonJS) and breaks under Vitest's
// ESM loader. These pure-helper tests never touch the hooks — stub the modules
// so importing `./-cash-management` doesn't pull that graph in.
vi.mock("@/api/useCapitalWalletBalance", () => ({
  useCapitalWalletBalance: vi.fn(),
}));
vi.mock("@/api/useRampAddresses", () => ({ useRampAddresses: vi.fn() }));

import {
  truncateStrkey,
  formatRelativeAge,
  formatUsdcAmount,
} from "./-cash-management";

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

describe("formatUsdcAmount", () => {
  it("adds thousands separators", () => {
    expect(formatUsdcAmount(8400000)).toBe("8,400,000");
    expect(formatUsdcAmount(1234.5)).toBe("1,234.5");
  });

  it('returns "—" for null / non-finite (never fabricated)', () => {
    expect(formatUsdcAmount(null)).toBe("—");
    expect(formatUsdcAmount(undefined)).toBe("—");
    expect(formatUsdcAmount(NaN)).toBe("—");
  });
});

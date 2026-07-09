/**
 * Tests for `src/utils/formatDate.ts` — the Origination table's Maturity
 * (Unix seconds → "15 Dec 2026") and Submitted (RFC 3339 → "18 Jun")
 * formatters (issue #813).
 */
import { describe, it, expect } from "vitest";
import { formatMaturityDate, formatSubmittedDate } from "./formatDate";

describe("formatMaturityDate", () => {
  it("formats a Unix-seconds timestamp as day + short month + year (Figma: 15 Dec 2026)", () => {
    // 2026-12-15T00:00:00Z
    expect(formatMaturityDate(1_797_292_800)).toBe("15 Dec 2026");
  });

  it("formats another timestamp (Figma: 30 Jun 2026)", () => {
    // 2026-06-30T00:00:00Z
    expect(formatMaturityDate(1_782_777_600)).toBe("30 Jun 2026");
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatMaturityDate(null)).toBe("—");
    expect(formatMaturityDate(undefined)).toBe("—");
  });

  it("returns em-dash for non-finite input", () => {
    expect(formatMaturityDate(NaN)).toBe("—");
    expect(formatMaturityDate(Infinity)).toBe("—");
  });
});

describe("formatSubmittedDate", () => {
  it("formats an RFC 3339 timestamp as day + short month, no year (Figma: 18 Jun)", () => {
    expect(formatSubmittedDate("2026-06-18T10:00:00Z")).toBe("18 Jun");
  });

  it("formats another RFC 3339 timestamp (Figma: 2 Jan)", () => {
    expect(formatSubmittedDate("2026-01-02T00:00:00Z")).toBe("2 Jan");
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatSubmittedDate(null)).toBe("—");
    expect(formatSubmittedDate(undefined)).toBe("—");
  });

  it("returns em-dash for an unparseable string", () => {
    expect(formatSubmittedDate("not-a-date")).toBe("—");
  });
});

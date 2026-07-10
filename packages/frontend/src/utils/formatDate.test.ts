/**
 * Unit tests for the LP frontend's In-Origination date formatters
 * (issue #814), mirroring `packages/trustee/src/utils/formatDate.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { formatMaturityDate, formatSubmittedDate } from "./formatDate";

// ── formatMaturityDate ──────────────────────────────────────────────────────

describe("formatMaturityDate", () => {
  it("formats a Unix-seconds timestamp as day + short month + full year", () => {
    // 2026-12-15T00:00:00Z
    expect(formatMaturityDate(1_797_292_800)).toBe("15 Dec 2026");
  });

  it("returns em-dash for null", () => {
    expect(formatMaturityDate(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatMaturityDate(undefined)).toBe("—");
  });

  it("returns em-dash for non-finite input", () => {
    expect(formatMaturityDate(NaN)).toBe("—");
  });
});

// ── formatSubmittedDate ─────────────────────────────────────────────────────

describe("formatSubmittedDate", () => {
  it("formats an RFC 3339 timestamp as day + short month (no year)", () => {
    expect(formatSubmittedDate("2026-06-18T10:00:00Z")).toBe("18 Jun");
  });

  it("returns em-dash for null", () => {
    expect(formatSubmittedDate(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatSubmittedDate(undefined)).toBe("—");
  });

  it("returns em-dash for an unparseable string", () => {
    expect(formatSubmittedDate("not-a-date")).toBe("—");
  });
});

/**
 * Tests for `src/utils/formatDate.ts` — the Origination table's Maturity
 * (Unix seconds → "15 Dec 2026") and Submitted (RFC 3339 → "18 Jun")
 * formatters (issue #813).
 */
import { describe, it, expect } from "vitest";
import {
  formatAuditTimestamp,
  formatEpochDate,
  formatMaturityDate,
  formatSubmittedDate,
} from "./formatDate";

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

describe("formatEpochDate", () => {
  it("formats an RFC 3339 timestamp as day + short month + year (#857)", () => {
    expect(formatEpochDate("2026-06-18T18:17:37Z")).toBe("18 Jun 2026");
    expect(formatEpochDate("2029-08-19T04:04:17Z")).toBe("19 Aug 2029");
  });

  it("returns em-dash for null/undefined/unparseable", () => {
    expect(formatEpochDate(null)).toBe("—");
    expect(formatEpochDate(undefined)).toBe("—");
    expect(formatEpochDate("not-a-date")).toBe("—");
  });
});

describe("formatAuditTimestamp", () => {
  it("formats an ISO-8601 timestamp as day + short month + 24h time (Figma: 24 Jun 07:12)", () => {
    // Rendered in UTC regardless of the runner's timezone.
    expect(formatAuditTimestamp("2026-06-24T07:12:00Z")).toBe("24 Jun 07:12");
  });

  it("zero-pads the hour and uses no year", () => {
    expect(formatAuditTimestamp("2026-01-02T09:30:00Z")).toBe("2 Jan 09:30");
  });

  it("returns em-dash for null/undefined/unparseable", () => {
    expect(formatAuditTimestamp(null)).toBe("—");
    expect(formatAuditTimestamp(undefined)).toBe("—");
    expect(formatAuditTimestamp("not-a-date")).toBe("—");
  });
});

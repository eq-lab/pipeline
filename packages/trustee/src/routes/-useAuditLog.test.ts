/**
 * Tests for the Audit Log presenter logic (`-useAuditLog.ts`, issue #1004).
 *
 * All pure — no DOM, no query layer. Covers scope-label resolution (friendly
 * loan name → server fallback → "Protocol"), reference truncation, and the
 * row mapping (rows are exactly what the feed serves, newest-first preserved,
 * never fabricated).
 */
import { describe, it, expect } from "vitest";
import type { AuditLogItem } from "@/api/useAuditLog";
import {
  buildAuditRows,
  resolveScopeLabel,
  truncateReference,
} from "./-useAuditLog";

function makeItem(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    timestamp: "2026-06-24T07:12:00Z",
    action: "Repayment recorded — principal + final interest",
    scope: { loan_id: "4492", label: "Loan #4492" },
    reference: "0xabc1234567890def1234567890abcdef12345678",
    event_name: "PaymentRecorded",
    details: {},
    ...overrides,
  };
}

describe("truncateReference", () => {
  it("truncates a long tx hash to first-6…last-4", () => {
    expect(truncateReference("0xabc1234567890def1234567890abcdef")).toBe(
      "0xabc1…cdef",
    );
  });

  it("leaves a short reference untouched", () => {
    expect(truncateReference("0xabc123")).toBe("0xabc123");
  });
});

describe("resolveScopeLabel", () => {
  const names = new Map([["4492", "Helios Metals — Lithium"]]);

  it("uses the friendly loan name when the loan id is known", () => {
    expect(resolveScopeLabel(makeItem(), names)).toBe(
      "Helios Metals — Lithium",
    );
  });

  it("falls back to the server label when the loan id is unknown", () => {
    const item = makeItem({ scope: { loan_id: "9999", label: "Loan #9999" } });
    expect(resolveScopeLabel(item, names)).toBe("Loan #9999");
  });

  it("uses the server label for protocol-scoped events (null loan id)", () => {
    const item = makeItem({ scope: { loan_id: null, label: "Protocol" } });
    expect(resolveScopeLabel(item, names)).toBe("Protocol");
  });
});

describe("buildAuditRows", () => {
  const names = new Map([["4492", "Helios Metals — Lithium"]]);

  it("maps each item to a display row, preserving order", () => {
    const items = [
      makeItem({
        action: "A",
        reference: "0xaaaa000000000000000000000000000000000001",
      }),
      makeItem({
        action: "B",
        reference: "0xbbbb000000000000000000000000000000000002",
      }),
    ];
    const rows = buildAuditRows(items, names);
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(rows.map((r) => r.action)).toEqual(["A", "B"]);
    expect(first!.scopeLabel).toBe("Helios Metals — Lithium");
    expect(first!.reference).toBe("0xaaaa…0001");
    expect(first!.referenceFull).toBe(items[0]!.reference);
    // Time is formatted (day + short month + 24h); exact value is TZ-dependent.
    expect(first!.time).toMatch(/\w{3}/);
    expect(first!.key).not.toBe(second!.key);
  });

  it("returns an empty array for an empty feed (no fabricated rows)", () => {
    expect(buildAuditRows([], names)).toEqual([]);
  });
});

// spec: docs/frontend/trustee-flows.md#audit-log (all-chains feed, (chain_id, loan_id) scope names, loan-name reference, #1599).
import { describe, it, expect } from "vitest";
import type { AuditLogItem } from "@/api/useAuditLog";
import {
  buildAuditRows,
  formatReference,
  resolveScopeLabel,
} from "./-useAuditLog";

function makeItem(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    chain_id: 99_000_001,
    timestamp: "2026-06-24T07:12:00Z",
    action: "Repayment recorded — principal + final interest",
    scope: { loan_id: "4492", label: "Loan #4492" },
    reference: "Helios Metals — Lithium",
    event_name: "PaymentRecorded",
    details: {},
    ...overrides,
  };
}

const names = new Map([
  ["99000001:4492", "Helios Metals — Lithium"],
  ["560048:4492", "Hoodi Copper Co — Copper Concentrate"],
]);

describe("formatReference", () => {
  it("renders the served loan name in full — it is not a tx hash", () => {
    expect(formatReference("Open Mineral — Copper Concentrate")).toBe(
      "Open Mineral — Copper Concentrate",
    );
  });

  it("renders a dash for an empty reference", () => {
    expect(formatReference("")).toBe("—");
  });
});

describe("resolveScopeLabel", () => {
  it("uses the friendly loan name for the item's own chain", () => {
    expect(resolveScopeLabel(makeItem(), names)).toBe(
      "Helios Metals — Lithium",
    );
  });

  it("keeps two loans with the same id on different chains apart (#1537 Story 5)", () => {
    expect(resolveScopeLabel(makeItem({ chain_id: 560048 }), names)).toBe(
      "Hoodi Copper Co — Copper Concentrate",
    );
  });

  it("falls back to the server label when the (chain, loan) pair is unknown", () => {
    const item = makeItem({ scope: { loan_id: "9999", label: "Loan #9999" } });
    expect(resolveScopeLabel(item, names)).toBe("Loan #9999");
    expect(
      resolveScopeLabel(
        makeItem({
          chain_id: 1,
          scope: { loan_id: "4492", label: "Loan #4492" },
        }),
        names,
      ),
    ).toBe("Loan #4492");
  });

  it("uses the server label for protocol-scoped events (null loan id)", () => {
    const item = makeItem({ scope: { loan_id: null, label: "Protocol" } });
    expect(resolveScopeLabel(item, names)).toBe("Protocol");
  });
});

describe("buildAuditRows", () => {
  it("maps each item to a display row with its chain label, preserving order", () => {
    const items = [
      makeItem({ action: "A" }),
      makeItem({
        action: "B",
        chain_id: 560048,
        reference: "",
        event_name: "DealRegistered",
        scope: { loan_id: null, label: "Protocol" },
      }),
    ];
    const rows = buildAuditRows(items, names);
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(rows.map((r) => r.action)).toEqual(["A", "B"]);
    expect(first!.chain).toBe("Stellar");
    expect(first!.scopeLabel).toBe("Helios Metals — Lithium");
    expect(first!.reference).toBe("Helios Metals — Lithium");
    expect(second!.chain).toBe("Hoodi");
    expect(second!.scopeLabel).toBe("Protocol");
    expect(second!.reference).toBe("—");
    expect(first!.time).toMatch(/\w{3}/);
    expect(first!.key).not.toBe(second!.key);
  });

  it("returns an empty array for an empty feed (no fabricated rows)", () => {
    expect(buildAuditRows([], names)).toEqual([]);
  });
});

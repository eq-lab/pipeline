// spec: docs/frontend/dashboard-components.md#activity-feed
import { describe, it, expect } from "vitest";
import type { RequestItem, WireInItem, WireOutItem } from "@/api";
import { mergeActivityFeed } from "./useActivityFeed";

const req = (id: string, created_at: string): RequestItem => ({
  type: "Deposit",
  chain_id: 1,
  request_id: id,
  amount: "1",
  status: "Completed",
  created_at,
});

const wireIn = (
  id: number,
  recorded_at: string,
  assigned_at?: string,
): WireInItem => ({
  chain_id: 1,
  id,
  status: assigned_at ? "Assigned" : "Direct",
  amount: "10",
  value_date: "2026-05-01",
  ref_hash: "0x",
  recorded_at,
  assigned_at,
});

const wireOut = (id: number, requested_at: string): WireOutItem => ({
  chain_id: 1,
  id,
  status: "Pending",
  amount: "5",
  requested_at,
});

function label(entry: ReturnType<typeof mergeActivityFeed>[number]): string {
  return entry.kind === "request"
    ? `r${entry.item.request_id}`
    : `${entry.kind === "wireIn" ? "i" : "o"}${entry.item.id}`;
}

describe("mergeActivityFeed", () => {
  it("returns exactly the requests when the wire lists are omitted", () => {
    const requests = [
      req("a", "2026-10-30T10:00:00Z"),
      req("b", "2026-10-28T10:00:00Z"),
    ];
    expect(mergeActivityFeed({ requests }).map(label)).toEqual(["ra", "rb"]);
  });

  it("returns an empty feed for undefined data", () => {
    expect(mergeActivityFeed(undefined)).toEqual([]);
  });

  it("interleaves all three lists newest first", () => {
    const merged = mergeActivityFeed({
      requests: [
        req("a", "2026-10-30T10:00:00Z"),
        req("b", "2026-10-26T10:00:00Z"),
      ],
      wire_ins: [wireIn(1, "2026-10-29T10:00:00Z")],
      wire_outs: [wireOut(2, "2026-10-27T10:00:00Z")],
    });
    expect(merged.map(label)).toEqual(["ra", "i1", "o2", "rb"]);
  });

  it("sorts an assigned wire-in by assigned_at and a direct one by recorded_at", () => {
    const merged = mergeActivityFeed({
      requests: [req("a", "2026-10-29T10:00:00Z")],
      wire_ins: [
        wireIn(1, "2026-10-01T10:00:00Z", "2026-10-30T10:00:00Z"),
        wireIn(2, "2026-10-28T10:00:00Z"),
      ],
    });
    expect(merged.map(label)).toEqual(["i1", "ra", "i2"]);
  });

  it("breaks ties request, wire-in, wire-out and keeps served order within a list", () => {
    const t = "2026-10-30T10:00:00Z";
    const merged = mergeActivityFeed({
      requests: [req("a", t), req("b", t)],
      wire_ins: [wireIn(1, t), wireIn(2, t)],
      wire_outs: [wireOut(3, t)],
    });
    expect(merged.map(label)).toEqual(["ra", "rb", "i1", "i2", "o3"]);
  });

  it("sorts an unparseable timestamp last", () => {
    const merged = mergeActivityFeed({
      requests: [req("a", "2026-10-30T10:00:00Z")],
      wire_outs: [wireOut(1, "not-a-date")],
    });
    expect(merged.map(label)).toEqual(["ra", "o1"]);
  });
});

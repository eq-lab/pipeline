// spec: docs/frontend/dashboard-components.md#recentactivitycard
import { describe, it, expect } from "vitest";
import type { RequestItem } from "@/api";
import { mergeActivityFeed } from "./useActivityFeed";

const req = (id: string, created_at: string): RequestItem => ({
  type: "Deposit",
  chain_id: 1,
  request_id: id,
  amount: "1",
  status: "Completed",
  created_at,
});

describe("mergeActivityFeed", () => {
  it("interleaves by served time, newest first, preserving each list's order", () => {
    const merged = mergeActivityFeed(
      [req("a", "2026-10-30T10:00:00Z"), req("b", "2026-10-28T10:00:00Z")],
      [
        { id: "9", timestamp: "2026-10-29T10:00:00Z" },
        { id: "8", timestamp: "2026-10-27T10:00:00Z" },
      ],
    );
    expect(
      merged.map((m) => (m.kind === "request" ? m.item.request_id : m.id)),
    ).toEqual(["a", "9", "b", "8"]);
  });

  it("puts requests first on equal timestamps and handles empty inputs", () => {
    const t = "2026-10-30T10:00:00Z";
    expect(
      mergeActivityFeed([req("a", t)], [{ id: "1", timestamp: t }]).map(
        (m) => m.kind,
      ),
    ).toEqual(["request", "wireOut"]);
    expect(mergeActivityFeed([], [])).toEqual([]);
    expect(mergeActivityFeed([], [{ id: "1", timestamp: t }])).toHaveLength(1);
  });
});

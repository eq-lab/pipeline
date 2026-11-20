// spec: docs/frontend/trustee-flows.md#trustee-sidebar-figma-node-41168855-aside
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AttentionCountsResponse } from "@/api/useAttentionCounts";
import { navBadgeCounts, useNavBadgeCounts } from "./useNavBadgeCounts";

const hoisted = vi.hoisted(() => ({
  query: { data: undefined, error: null } as {
    data: unknown;
    error: Error | null;
  },
  chainId: 99_000_001 as number | undefined,
}));

vi.mock("@/api/useAttentionCounts", () => ({
  useAttentionCounts: () => hoisted.query,
}));

vi.mock("@/auth/sessionStore", () => ({
  useSessionState: () => ({ chainId: hoisted.chainId }),
}));

function chainEntry(chain_id: number, cashCount: number) {
  return {
    chain_id,
    origination: { count: 1 },
    loans: { count: 1 },
    cash_management: { count: cashCount },
  };
}

function fixture(): AttentionCountsResponse {
  return {
    origination: { count: 7 },
    loans: { count: 9 },
    cash_management: { count: 100 },
    chains: [chainEntry(99_000_001, 4), chainEntry(560048, 6)],
  } as unknown as AttentionCountsResponse;
}

describe("navBadgeCounts", () => {
  it("reads Origination and Loans from the combined sections", () => {
    const out = navBadgeCounts(fixture(), 99_000_001);
    expect(out["/origination"]).toBe(7);
    expect(out["/loans"]).toBe(9);
  });

  it("reads Cash Management from the session chain entry", () => {
    expect(navBadgeCounts(fixture(), 99_000_001)["/cash-management"]).toBe(4);
    expect(navBadgeCounts(fixture(), 560048)["/cash-management"]).toBe(6);
  });

  it("omits Cash Management without a chain or a matching entry", () => {
    for (const chainId of [undefined, 1]) {
      expect(navBadgeCounts(fixture(), chainId)).toEqual({
        "/origination": 7,
        "/loans": 9,
      });
    }
  });

  it("returns nothing while there is no data", () => {
    expect(navBadgeCounts(undefined, 560048)).toEqual({});
  });

  it("hides a served 0", () => {
    const data = fixture();
    data.origination.count = 0;
    data.chains[0]!.cash_management.count = 0;
    expect(navBadgeCounts(data, 99_000_001)).toEqual({ "/loans": 9 });
  });

  it("omits a missing or non-number count", () => {
    const data = {
      origination: {},
      loans: { count: "3" },
      cash_management: { count: 1 },
    } as unknown as AttentionCountsResponse;
    expect(navBadgeCounts(data, 99_000_001)).toEqual({});
  });
});

describe("useNavBadgeCounts", () => {
  beforeEach(() => {
    hoisted.query = { data: fixture(), error: null };
    hoisted.chainId = 560048;
  });

  it("returns the selected map when data is present", () => {
    const { result } = renderHook(() => useNavBadgeCounts());
    expect(result.current).toEqual({
      "/origination": 7,
      "/loans": 9,
      "/cash-management": 6,
    });
  });

  it("returns nothing on error even with stale data", () => {
    hoisted.query = { data: fixture(), error: new Error("boom") };
    const { result } = renderHook(() => useNavBadgeCounts());
    expect(result.current).toEqual({});
  });
});

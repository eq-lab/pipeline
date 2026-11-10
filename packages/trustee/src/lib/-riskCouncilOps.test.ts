// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  _resetRiskCouncilOpsForTests,
  markExecuted,
  recordScheduledOp,
  riskCouncilCallKey,
  useScheduledOp,
  useScheduledOps,
} from "./riskCouncilOps";

const A = { fn: "set_default", loanId: 1 } as const;
const B = { fn: "write_down", loanId: 1, amount: "5" } as const;

beforeEach(() => _resetRiskCouncilOpsForTests());

describe("riskCouncilOps", () => {
  it("records, dedupes by key and filters by chain", () => {
    const { result } = renderHook(() => useScheduledOps(1));
    expect(result.current).toEqual([]);
    act(() => {
      recordScheduledOp({ chainId: 1, call: A });
      recordScheduledOp({ chainId: 1, call: A });
      recordScheduledOp({ chainId: 1, call: B });
      recordScheduledOp({ chainId: 2, call: A });
    });
    expect(result.current).toHaveLength(2);
    expect(result.current.every((op) => op.chainId === 1)).toBe(true);
    expect(result.current[0]!.executedHere).toBe(false);
  });

  it("marks an op executed and notifies subscribers", () => {
    const { result } = renderHook(() => useScheduledOp(1, A));
    expect(result.current).toBeUndefined();
    act(() => recordScheduledOp({ chainId: 1, call: A }));
    expect(result.current?.executedHere).toBe(false);
    act(() => markExecuted(1, A));
    expect(result.current?.executedHere).toBe(true);
  });

  it("ignores markExecuted for an unknown op", () => {
    const { result } = renderHook(() => useScheduledOps(1));
    act(() => markExecuted(1, A));
    expect(result.current).toEqual([]);
  });

  it("builds a key independent of property order", () => {
    expect(
      riskCouncilCallKey({ fn: "write_down", amount: "5", loanId: 1 }),
    ).toBe(riskCouncilCallKey(B));
  });

  it("keeps a stable snapshot between unrelated renders", () => {
    const { result, rerender } = renderHook(() => useScheduledOps(1));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

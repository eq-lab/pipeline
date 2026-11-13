// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  _resetRiskCouncilOpsForTests,
  councilTarget,
  type CouncilCall,
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

describe("security calls", () => {
  const RELEASE = {
    fn: "release_with_consent",
    recordId: 3,
    consentHash: "ab".repeat(32),
  } as const;
  const TERMS = {
    fn: "set_terms",
    loanId: 4,
    terms: {
      advanceRatioBps: 7000,
      marginCallRatioBps: 8000,
      curePeriod: "604800",
      priceStaleAfter: "86400",
      paymentTerm: "Da",
      gracePeriod: "0",
      defaultRate: 20000,
      attestationInterval: "0",
      inspectionInterval: "0",
      toleranceBps: 50,
      gradeToleranceBps: 25,
    },
  } as const;

  it("maps each function to its target", () => {
    expect(councilTarget("set_default")).toBe("loan_registry");
    expect(councilTarget({ fn: "write_down", loanId: 1, amount: "5" })).toBe(
      "loan_registry",
    );
    for (const fn of [
      "set_terms",
      "resolve_flag",
      "release_with_consent",
      "set_inspectors",
    ] as const) {
      expect(councilTarget(fn)).toBe("security_registry");
    }
  });

  it("keeps the loan context on record-keyed calls", () => {
    const { result } = renderHook(() => useScheduledOps(1));
    act(() => recordScheduledOp({ chainId: 1, call: RELEASE, loanId: 9 }));
    expect(result.current[0]!.loanId).toBe(9);
    expect(result.current[0]!.call).toEqual(RELEASE);
  });

  it("keys by every term field regardless of property order", () => {
    const reordered = {
      terms: { ...TERMS.terms },
      loanId: 4,
      fn: "set_terms",
    } as const;
    expect(riskCouncilCallKey(reordered)).toBe(riskCouncilCallKey(TERMS));
    expect(
      riskCouncilCallKey({
        ...TERMS,
        terms: { ...TERMS.terms, toleranceBps: 51 },
      }),
    ).not.toBe(riskCouncilCallKey(TERMS));
  });

  it("treats inspector order as significant", () => {
    const a: CouncilCall = { fn: "set_inspectors", inspectors: ["GA", "GB"] };
    const b: CouncilCall = { fn: "set_inspectors", inspectors: ["GB", "GA"] };
    expect(riskCouncilCallKey(a)).not.toBe(riskCouncilCallKey(b));
  });
});

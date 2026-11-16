// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  _resetRiskCouncilOpsForTests,
  councilTarget,
  type CouncilCall,
  markExecuted,
  markOperationExecuted,
  recordScheduledOp,
  riskCouncilCallKey,
  pruneExecutedOperations,
  useExecutedOperations,
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

describe("operation bridge", () => {
  it("keeps the chain fields on a recorded op", () => {
    const { result } = renderHook(() => useScheduledOps(1));
    act(() =>
      recordScheduledOp({
        chainId: 1,
        call: A,
        operationId: "op",
        readyAt: 10,
        caller: "G1",
        target: "C1",
        argsXdr: "AAAA",
      }),
    );
    expect(result.current[0]).toMatchObject({
      operationId: "op",
      readyAt: 10,
      caller: "G1",
      target: "C1",
      argsXdr: "AAAA",
    });
  });

  it("omits the chain fields when they are not given", () => {
    const { result } = renderHook(() => useScheduledOps(1));
    act(() => recordScheduledOp({ chainId: 1, call: A }));
    expect("operationId" in result.current[0]!).toBe(false);
  });

  it("flags matching ops and tracks executed operations per chain", () => {
    const ops1 = renderHook(() => useScheduledOps(1));
    const ids1 = renderHook(() => useExecutedOperations(1));
    const ids2 = renderHook(() => useExecutedOperations(2));
    act(() => {
      recordScheduledOp({
        chainId: 1,
        call: A,
        operationId: "op",
        readyAt: 10,
      });
      recordScheduledOp({ chainId: 1, call: B, operationId: "other" });
      markOperationExecuted(1, "op", "H1");
    });
    expect(ops1.result.current.map((op) => op.executedHere)).toEqual([
      true,
      false,
    ]);
    expect(Array.from(ids1.result.current.keys())).toEqual(["op"]);
    expect(ids1.result.current.get("op")).toMatchObject({
      hash: "H1",
      readyAt: 10,
    });
    expect(ids2.result.current.size).toBe(0);
  });

  it("prefers the given ready time over the session one", () => {
    const ids = renderHook(() => useExecutedOperations(1));
    act(() => {
      recordScheduledOp({
        chainId: 1,
        call: A,
        operationId: "op",
        readyAt: 10,
      });
      markOperationExecuted(1, "op", "H", 20);
    });
    expect(ids.result.current.get("op")!.readyAt).toBe(20);
  });

  it("records the executed id when a session op is executed from the form", () => {
    const ids = renderHook(() => useExecutedOperations(1));
    act(() => {
      recordScheduledOp({
        chainId: 1,
        call: A,
        operationId: "op",
        readyAt: 10,
      });
      markExecuted(1, A, "HF");
    });
    expect(ids.result.current.get("op")).toMatchObject({
      hash: "HF",
      readyAt: 10,
    });
  });

  it("does not record an id for a session op without one", () => {
    const ids = renderHook(() => useExecutedOperations(1));
    act(() => {
      recordScheduledOp({ chainId: 1, call: A });
      markExecuted(1, A, "HF");
    });
    expect(ids.result.current.size).toBe(0);
  });

  it("keeps a stable snapshot when nothing changes", () => {
    const ids = renderHook(() => useExecutedOperations(1));
    act(() => markOperationExecuted(1, "op", "H"));
    const first = ids.result.current;
    act(() => pruneExecutedOperations(1, new Map([["op", 5]]), 0));
    expect(ids.result.current).toBe(first);
    expect(first.size).toBe(1);
  });

  it("prunes an executed id once a later fetch no longer serves it", () => {
    const ids = renderHook(() => useExecutedOperations(1));
    act(() => markOperationExecuted(1, "op", "H", 10));
    const after = Date.now() + 1000;
    act(() => pruneExecutedOperations(1, new Map([["op", 10]]), after));
    expect(ids.result.current.size).toBe(1);
    act(() => pruneExecutedOperations(1, new Map(), after - 2000));
    expect(ids.result.current.size).toBe(1);
    act(() => pruneExecutedOperations(2, new Map(), after));
    expect(ids.result.current.size).toBe(1);
    act(() => pruneExecutedOperations(1, new Map(), after));
    expect(ids.result.current.size).toBe(0);
  });

  it("prunes an executed id when the served schedule has a new ready time", () => {
    const ids = renderHook(() => useExecutedOperations(1));
    act(() => markOperationExecuted(1, "op", "H", 10));
    act(() =>
      pruneExecutedOperations(1, new Map([["op", 99]]), Date.now() + 1000),
    );
    expect(ids.result.current.size).toBe(0);
  });

  it("clears the executed operations on reset", () => {
    const ids = renderHook(() => useExecutedOperations(1));
    act(() => markOperationExecuted(1, "op", "H"));
    act(() => _resetRiskCouncilOpsForTests());
    const fresh = renderHook(() => useExecutedOperations(1));
    expect(fresh.result.current.size).toBe(0);
    expect(ids.result.current.size).toBe(1);
  });
});

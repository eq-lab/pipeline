// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  _resetRiskCouncilOpsForTests,
  recordScheduledOp,
} from "@/lib/riskCouncilOps";
import {
  HASH_B,
  OPERATION_ID,
  READY_AT,
  SCHEDULER,
  SECURITY_REGISTRY,
  STELLAR,
  loanBookResult,
  loanEntry,
  pendingOp,
} from "./-riskCouncilFixtures";

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@pipeline/wallet-connect", () => ({
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  useStellarWallet: () => ({ address: SCHEDULER }),
}));

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanPendingOps } from "./-risk-council-pending";

const mockLoanBook = vi.mocked(useLoanBook);

function serve(ids: string[]) {
  const entry = loanEntry({
    loan_id: "7",
    pending_operations: ids.map((operation_id) =>
      pendingOp({
        operation_id,
        function: "release_with_consent",
        args: [3, HASH_B],
      }),
    ),
  });
  mockLoanBook.mockReturnValue({
    ...loanBookResult([entry]),
    dataUpdatedAt: Date.now() + 10,
  } as unknown as ReturnType<typeof useLoanBook>);
  return entry;
}

function renderOps() {
  return renderHook(() =>
    useLoanPendingOps({
      chainId: STELLAR,
      loanId: 7,
      entry: mockLoanBook().data?.loans[0],
    }),
  );
}

beforeEach(() => {
  _resetRiskCouncilOpsForTests();
  recordScheduledOp({
    chainId: STELLAR,
    call: { fn: "release_with_consent", recordId: 3, consentHash: HASH_B },
    loanId: 7,
    operationId: OPERATION_ID,
    readyAt: READY_AT,
    caller: SCHEDULER,
    target: SECURITY_REGISTRY,
    argsXdr: "AAAA",
  });
});

describe("useLoanPendingOps session bridge", () => {
  it("bridges a session row the API has never served", () => {
    serve([]);
    const { result } = renderOps();
    expect(result.current.map((i) => i.source)).toEqual(["session"]);
  });

  it("stops bridging a row once the API served it and then stopped", () => {
    serve([OPERATION_ID]);
    const { result, rerender } = renderOps();
    expect(result.current.map((i) => i.source)).toEqual(["indexed"]);
    serve([]);
    act(() => rerender());
    expect(result.current).toEqual([]);
  });
});

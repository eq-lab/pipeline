// spec: docs/frontend/trustee-flows.md#amend-and-resubmit-originationidedit-1913
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { useOriginationEdit } from "./-origination-edit";

vi.mock("@/api/useLoanSubmissions", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/useLoanSubmissions")
  >("@/api/useLoanSubmissions");
  return { ...actual, useLoanSubmissions: vi.fn() };
});
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return { ...actual, useNavigate: () => vi.fn() };
});

import { useLoanSubmissions } from "@/api/useLoanSubmissions";

function row(status: string, reason: string | null = "Fix it"): SubmissionView {
  return {
    id: 7,
    status,
    reason,
    originator: "GABC",
    target_chain_id: 99000001,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    documents: [],
    loan_data: {
      originator: "Auric Andes",
      commodity: "Gold",
    } as SubmissionView["loan_data"],
  };
}

function mockList(
  data: SubmissionView[] | undefined,
  isLoading = false,
  error: Error | null = null,
) {
  vi.mocked(useLoanSubmissions).mockReturnValue({
    data,
    isLoading,
    error,
    refetch: vi.fn(),
  });
}

describe("useOriginationEdit (#1913)", () => {
  it("is loading while the list loads and there is no router state", () => {
    mockList(undefined, true);
    const { result } = renderHook(() => useOriginationEdit("7", undefined));
    expect(result.current.state).toBe("loading");
  });

  it("surfaces a list failure as error with friendly copy and raw details", () => {
    mockList(undefined, false, new Error("network down"));
    const { result } = renderHook(() => useOriginationEdit("7", undefined));
    expect(result.current.state).toBe("error");
    expect(result.current.errorMessage).toBe("Failed to load the submission.");
    expect(result.current.errorDetails).toBe("network down");
  });

  it("is not-found when the id is absent from the list", () => {
    mockList([row("ChangesRequested")]);
    const { result } = renderHook(() => useOriginationEdit("99", undefined));
    expect(result.current.state).toBe("not-found");
  });

  it.each(["InReview", "Approved", "Rejected"])(
    "is not-editable for %s",
    (status) => {
      mockList([row(status)]);
      const { result } = renderHook(() => useOriginationEdit("7", undefined));
      expect(result.current.state).toBe("not-editable");
    },
  );

  it("is ready for ChangesRequested with reason, date and heading", () => {
    mockList([row("ChangesRequested", "Attach the agreement")]);
    const { result } = renderHook(() => useOriginationEdit("7", undefined));
    expect(result.current.state).toBe("ready");
    expect(result.current.reason).toBe("Attach the agreement");
    expect(result.current.heading).toBe("Auric Andes — Gold");
    expect(result.current.reviewedDate).not.toBe("—");
  });

  it("prefers the live list copy over router state", () => {
    mockList([row("InReview")]);
    const { result } = renderHook(() =>
      useOriginationEdit("7", row("ChangesRequested")),
    );
    expect(result.current.state).toBe("not-editable");
  });

  it("uses router state as first paint while the list loads", () => {
    mockList(undefined, true);
    const { result } = renderHook(() =>
      useOriginationEdit("7", row("ChangesRequested")),
    );
    expect(result.current.state).toBe("ready");
  });
});

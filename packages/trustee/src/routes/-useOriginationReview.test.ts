/**
 * Tests for `useOriginationReview` (issue #829) — the Origination details
 * page's Approve/Reject orchestration. Mocks `useReviewSubmission` so this
 * exercises only the orchestration/error-mapping logic, not the network.
 *
 * Covers:
 *   - `approve()` fires the mutation with `{ id, decision: "Approved" }` —
 *     no `reason` key.
 *   - `openReject()`/`cancelReject()` toggle `rejectOpen`.
 *   - `submitReject(reason)` fires `{ id, decision: "Rejected", reason }`.
 *   - On a successful reject, the dialog closes (`rejectOpen` → false).
 *   - On a failed reject, the dialog stays open.
 *   - Error status mapping: 409 → "already reviewed" copy, 403 → "not
 *     authorized" copy, ApiUnauthorizedError → session copy, other → generic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOriginationReview } from "./-useOriginationReview";
import { ApiError, ApiUnauthorizedError } from "@/api/client";

const mockMutate = vi.fn();
const mockReset = vi.fn();
let mockMutationState: { isPending: boolean; error: Error | null };

vi.mock("@/api/useReviewSubmission", () => ({
  useReviewSubmission: () => ({
    mutate: mockMutate,
    reset: mockReset,
    isPending: mockMutationState.isPending,
    error: mockMutationState.error,
  }),
}));

beforeEach(() => {
  mockMutate.mockReset();
  mockReset.mockReset();
  mockMutationState = { isPending: false, error: null };
});

describe("useOriginationReview", () => {
  it("approve() fires the mutation with { id, decision: 'Approved' } and no reason", () => {
    const { result } = renderHook(() => useOriginationReview("7"));
    act(() => result.current.approve());
    expect(mockMutate).toHaveBeenCalledWith({ id: 7, decision: "Approved" });
  });

  it("openReject()/cancelReject() toggle rejectOpen", () => {
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.rejectOpen).toBe(false);

    act(() => result.current.openReject());
    expect(result.current.rejectOpen).toBe(true);

    act(() => result.current.cancelReject());
    expect(result.current.rejectOpen).toBe(false);
    expect(mockReset).toHaveBeenCalled();
  });

  it("submitReject(reason) fires { id, decision: 'Rejected', reason } and closes the dialog on success", () => {
    mockMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.();
    });
    const { result } = renderHook(() => useOriginationReview("7"));

    act(() => result.current.openReject());
    expect(result.current.rejectOpen).toBe(true);

    act(() => result.current.submitReject("Missing export permit"));

    expect(mockMutate).toHaveBeenCalledWith(
      { id: 7, decision: "Rejected", reason: "Missing export permit" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(result.current.rejectOpen).toBe(false);
  });

  it("dialog stays open when the reject mutation does not call onSuccess (error case)", () => {
    mockMutate.mockImplementation(() => {
      // Simulates a failure: onSuccess is never invoked.
    });
    const { result } = renderHook(() => useOriginationReview("7"));

    act(() => result.current.openReject());
    act(() => result.current.submitReject("Missing export permit"));

    expect(result.current.rejectOpen).toBe(true);
  });

  it("maps a 409 ApiError to the 'already reviewed' copy", () => {
    mockMutationState = {
      isPending: false,
      error: new ApiError("Conflict", 409),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toMatch(/already been reviewed/);
  });

  it("maps a 403 ApiError to the 'not authorized' copy", () => {
    mockMutationState = {
      isPending: false,
      error: new ApiError("Forbidden", 403),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBe(
      "You are not authorized to review submissions.",
    );
  });

  it("maps ApiUnauthorizedError to session/expired copy", () => {
    mockMutationState = {
      isPending: false,
      error: new ApiUnauthorizedError("token expired"),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toMatch(/session/i);
  });

  it("maps an unrecognized status to a generic message including the backend message", () => {
    mockMutationState = {
      isPending: false,
      error: new ApiError("boom", 500),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toContain("boom");
  });

  it("returns null errorMessage when there is no error", () => {
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBeNull();
  });

  it("reflects isPending from the underlying mutation", () => {
    mockMutationState = { isPending: true, error: null };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.isPending).toBe(true);
  });
});

/**
 * Tests for `useOriginationReview` (issue #829, chain-first mint ordering
 * added by #831, approve-confirmation-dialog gate added by #838) — the
 * Origination details page's Approve/Reject orchestration. Mocks
 * `useReviewSubmission`, `useDrawLoan`, and `useLoanSubmissions` so this
 * exercises only the orchestration/error-mapping logic, not the
 * network/Soroban RPC.
 *
 * Covers:
 *   - `approve()` calls `useDrawLoan().mutateAsync` BEFORE
 *     `useReviewSubmission().mutate` (chain-first ordering) — UNCHANGED by
 *     #838; it is now invoked as the approve dialog's confirm action rather
 *     than directly by a page button, but the orchestration itself is
 *     identical.
 *   - A rejected/failed mint does NOT call review; the mapped on-chain error
 *     surfaces; the submission stays actionable (retryable).
 *   - A successful mint THEN triggers the `{ decision: "Approved" }` review
 *     call.
 *   - An already-`Approved` submission's `approve()` is a no-op (no mint, no
 *     review call) — the no-double-mint guard.
 *   - Re-clicking Approve after a mint-succeeded/review-failed retry skips
 *     the mint (no second `mutateAsync` call) and re-fires ONLY the review
 *     call — the idempotency guard keyed to `useDrawLoan`'s in-session
 *     `isSuccess` marker.
 *   - `isPending` reflects either mutation; `mintingLabel` reflects the mint
 *     stage, then "Finalizing approval…" while the review call is in
 *     flight after a successful mint.
 *   - The known-limitation message when the mint succeeds but review fails.
 *   - `openReject()`/`cancelReject()`/`submitReject()` and the #829 review
 *     error-status mapping are unchanged.
 *   - Issue #838: `approveOpen` defaults false; `openApprove()` opens it (and
 *     resets a stale review error); `cancelApprove()` closes it, always
 *     resets the review mutation, and resets the draw-loan mutation ONLY
 *     when it hasn't already succeeded (preserving the idempotency marker);
 *     the dialog closes itself once the review call succeeds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOriginationReview } from "./-useOriginationReview";
import { ApiError, ApiUnauthorizedError } from "@/api/client";
import type { SubmissionView } from "@/api/useLoanSubmissions";

// ── Mock @/api/useReviewSubmission ────────────────────────────────────────────

const mockMutate = vi.fn();
const mockReset = vi.fn();
let mockReviewState: { isPending: boolean; error: Error | null };

vi.mock("@/api/useReviewSubmission", () => ({
  useReviewSubmission: () => ({
    mutate: mockMutate,
    reset: mockReset,
    isPending: mockReviewState.isPending,
    error: mockReviewState.error,
  }),
}));

// ── Mock @/api/useDrawLoan ─────────────────────────────────────────────────────

const mockMutateAsync = vi.fn();
const mockDrawLoanReset = vi.fn();
let mockDrawLoanState: {
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: string | null;
};

vi.mock("@/api/useDrawLoan", () => ({
  useDrawLoan: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockDrawLoanState.isPending,
    isSuccess: mockDrawLoanState.isSuccess,
    error: mockDrawLoanState.error,
    stage: mockDrawLoanState.stage,
    reset: mockDrawLoanReset,
  }),
}));

// ── Mock @/api/useLoanSubmissions ──────────────────────────────────────────────

let mockSubmissions: SubmissionView[] | undefined;

vi.mock("@/api/useLoanSubmissions", () => ({
  useLoanSubmissions: () => ({
    data: mockSubmissions,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const LOAN_DATA = {
  to: "GHOLDER00000000000000000000000000000000000000000000000000",
  metadata_uri: "ipfs://loan-metadata",
  originator: "Auric Andes S.A.C.",
  borrower_id: "borrower-1",
  commodity: "Gold",
  corridor: "PE-CN",
  governing_law: "England & Wales",
  economics: {
    original_facility_size: "1200000.000000",
    original_senior_tranche: "1000000.000000",
    original_equity_tranche: "200000.000000",
    original_offtaker_price: "1250000.000000",
    senior_interest_rate_bps: 1000,
    origination_date: 1_750_000_000,
    original_maturity_date: 1_780_000_000,
  },
  initial_ccr: 1_500_000,
  initial_location: {
    location_type: "Vessel",
    location_identifier: "IMO-1234567",
    tracking_url: "https://track.example/1234567",
    updated_at: 1_750_000_100,
  },
} as SubmissionView["loan_data"];

function makeSubmission(
  overrides: Partial<SubmissionView> = {},
): SubmissionView {
  return {
    id: 7,
    status: "InReview",
    reason: null,
    originator: "GORIGINATOR00000000000000000000000000000000000000000000000",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    documents: [],
    loan_data: LOAN_DATA,
    ...overrides,
  };
}

beforeEach(() => {
  mockMutate.mockReset();
  mockReset.mockReset();
  mockMutateAsync.mockReset();
  mockDrawLoanReset.mockReset();
  mockReviewState = { isPending: false, error: null };
  mockDrawLoanState = {
    isPending: false,
    isSuccess: false,
    error: null,
    stage: null,
  };
  mockSubmissions = [makeSubmission()];
});

describe("useOriginationReview", () => {
  // ── Chain-first ordering (issue #831) ───────────────────────────────────────

  it("approve() calls drawLoan.mutateAsync BEFORE reviewSubmission.mutate, in order", async () => {
    const callOrder: string[] = [];
    mockMutateAsync.mockImplementation(async () => {
      callOrder.push("drawLoan");
      return { hash: "tx-hash" };
    });
    mockMutate.mockImplementation(() => {
      callOrder.push("review");
    });

    const { result } = renderHook(() => useOriginationReview("7"));
    await act(async () => {
      result.current.approve();
      // Flush the microtask queue so the async approve() body settles.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callOrder).toEqual(["drawLoan", "review"]);
    expect(mockMutateAsync).toHaveBeenCalledWith({ loanData: LOAN_DATA });
    expect(mockMutate).toHaveBeenCalledWith(
      { id: 7, decision: "Approved" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("a rejected/failed mint does NOT call review, and the submission stays actionable", async () => {
    mockMutateAsync.mockRejectedValue(new Error("Signature cancelled"));

    const { result } = renderHook(() => useOriginationReview("7"));
    await act(async () => {
      result.current.approve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("skips the mint entirely for an already-Approved submission (no-double-mint guard)", async () => {
    mockSubmissions = [makeSubmission({ status: "Approved" })];

    const { result } = renderHook(() => useOriginationReview("7"));
    await act(async () => {
      result.current.approve();
      await Promise.resolve();
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("re-clicking Approve after a mint-succeeded/review-failed retry skips the mint and only re-fires review (idempotency guard)", async () => {
    // Simulates the state after a first Approve click: the mint already
    // succeeded (useDrawLoan's mutation is `isSuccess`), but the review call
    // failed and left the submission InReview.
    mockDrawLoanState = {
      isPending: false,
      isSuccess: true,
      error: null,
      stage: null,
    };
    mockReviewState = { isPending: false, error: new Error("boom") };

    const { result } = renderHook(() => useOriginationReview("7"));
    act(() => result.current.approve());

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledWith(
      { id: 7, decision: "Approved" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("does nothing when the submission is not found", async () => {
    mockSubmissions = [];

    const { result } = renderHook(() => useOriginationReview("7"));
    await act(async () => {
      result.current.approve();
      await Promise.resolve();
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // ── isPending / mintingLabel ─────────────────────────────────────────────────

  it("isPending is true while the mint is in flight", () => {
    mockDrawLoanState = {
      isPending: true,
      isSuccess: false,
      error: null,
      stage: "awaiting-signature",
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.isPending).toBe(true);
  });

  it("isPending is true while the review call is in flight", () => {
    mockReviewState = { isPending: true, error: null };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.isPending).toBe(true);
  });

  it.each([
    ["awaiting-signature", "Waiting for wallet signature…"],
    ["submitting", "Submitting on-chain…"],
    ["confirming", "Confirming…"],
  ])("mintingLabel for stage %s is '%s'", (stage, label) => {
    mockDrawLoanState = {
      isPending: true,
      isSuccess: false,
      error: null,
      stage,
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.mintingLabel).toBe(label);
  });

  it("mintingLabel is 'Finalizing approval…' once the mint succeeds and review is in flight", () => {
    mockDrawLoanState = {
      isPending: false,
      isSuccess: true,
      error: null,
      stage: null,
    };
    mockReviewState = { isPending: true, error: null };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.mintingLabel).toBe("Finalizing approval…");
  });

  it("mintingLabel is null when not minting and not finalizing", () => {
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.mintingLabel).toBeNull();
  });

  // ── Mint error mapping ───────────────────────────────────────────────────────

  it("maps a simulation-error mint failure to a 'could not verify' + safe-to-retry message, raw text only in errorDetails", () => {
    mockDrawLoanState = {
      isPending: false,
      isSuccess: false,
      error: new Error("drawLoan simulation error: bad encoding"),
      stage: null,
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBe(
      "Could not verify the loan on-chain. No signature was requested — safe to retry.",
    );
    expect(result.current.errorMessage).not.toMatch(/bad encoding/);
    expect(result.current.errorDetails).toBe(
      "drawLoan simulation error: bad encoding",
    );
  });

  it("maps a wallet-rejection mint failure to 'Signature cancelled'", () => {
    mockDrawLoanState = {
      isPending: false,
      isSuccess: false,
      error: new Error("User declined access"),
      stage: null,
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBe(
      "Signature cancelled. Click Approve again to retry.",
    );
  });

  it("maps an unconfigured-registry mint failure to a configuration message", () => {
    mockDrawLoanState = {
      isPending: false,
      isSuccess: false,
      error: new Error(
        "On-chain minting is not configured for this environment.",
      ),
      stage: null,
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toMatch(/isn't configured/i);
  });

  it("maps a disconnected-wallet mint failure to a connect-wallet message", () => {
    mockDrawLoanState = {
      isPending: false,
      isSuccess: false,
      error: new Error("Stellar wallet not connected."),
      stage: null,
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toMatch(/Connect your trustee wallet/);
  });

  it("maps an unrecognized mint failure to the generic on-chain-failed message, raw text only in errorDetails (mint-default branch)", () => {
    mockDrawLoanState = {
      isPending: false,
      isSuccess: false,
      error: new Error("HostError: some unrecognized trap"),
      stage: null,
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBe(
      "The on-chain transaction failed. Please try again.",
    );
    expect(result.current.errorMessage).not.toMatch(/HostError/);
    expect(result.current.errorDetails).toBe(
      "HostError: some unrecognized trap",
    );
  });

  it("maps the mint-succeeded-but-review-failed known limitation distinctly, raw text only in errorDetails", () => {
    mockDrawLoanState = {
      isPending: false,
      isSuccess: true,
      error: null,
      stage: null,
    };
    mockReviewState = { isPending: false, error: new Error("boom") };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toMatch(/minted on-chain successfully/);
    expect(result.current.errorMessage).toMatch(/known limitation/);
    expect(result.current.errorMessage).not.toMatch(/boom/);
    expect(result.current.errorDetails).toBe("boom");
  });

  // ── Unchanged Reject flow + review error mapping (issue #829) ────────────────

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

  it("openRequestChanges()/cancelRequestChanges() toggle requestChangesOpen (#1017)", () => {
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.requestChangesOpen).toBe(false);

    act(() => result.current.openRequestChanges());
    expect(result.current.requestChangesOpen).toBe(true);

    act(() => result.current.cancelRequestChanges());
    expect(result.current.requestChangesOpen).toBe(false);
    expect(mockReset).toHaveBeenCalled();
  });

  it("submitRequestChanges(reason) fires { id, decision: 'ChangesRequested', reason }, closes on success, and never touches the mint (#1017)", () => {
    mockMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.();
    });
    const { result } = renderHook(() => useOriginationReview("7"));

    act(() => result.current.openRequestChanges());
    expect(result.current.requestChangesOpen).toBe(true);

    act(() =>
      result.current.submitRequestChanges("Assay certificate incomplete"),
    );

    expect(mockMutate).toHaveBeenCalledWith(
      {
        id: 7,
        decision: "ChangesRequested",
        reason: "Assay certificate incomplete",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(result.current.requestChangesOpen).toBe(false);
    // Pure DB call — the on-chain mint must never be involved.
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("request-changes dialog stays open when the mutation does not call onSuccess (error case, #1017)", () => {
    mockMutate.mockImplementation(() => {
      // Simulates a failure: onSuccess is never invoked.
    });
    const { result } = renderHook(() => useOriginationReview("7"));

    act(() => result.current.openRequestChanges());
    act(() =>
      result.current.submitRequestChanges("Assay certificate incomplete"),
    );

    expect(result.current.requestChangesOpen).toBe(true);
  });

  it("maps a 409 ApiError to the 'already reviewed' copy", () => {
    mockReviewState = {
      isPending: false,
      error: new ApiError("Conflict", 409),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toMatch(/already been reviewed/);
  });

  it("maps a 403 ApiError to the 'not authorized' copy", () => {
    mockReviewState = {
      isPending: false,
      error: new ApiError("Forbidden", 403),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBe(
      "You are not authorized to review submissions.",
    );
  });

  it("maps ApiUnauthorizedError to session/expired copy", () => {
    mockReviewState = {
      isPending: false,
      error: new ApiUnauthorizedError("token expired"),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toMatch(/session/i);
  });

  it("maps a 400 ApiError to the curated 'invalid request' copy, raw text only in errorDetails (review-400 branch)", () => {
    mockReviewState = {
      isPending: false,
      error: new ApiError("amount must be positive", 400),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBe("This request was invalid.");
    expect(result.current.errorMessage).not.toMatch(/amount must be positive/);
    expect(result.current.errorDetails).toBe("amount must be positive");
  });

  it("maps a 5xx ApiError to the service-unavailable copy, raw text only in errorDetails", () => {
    mockReviewState = {
      isPending: false,
      error: new ApiError("boom", 599),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBe(
      "The service is temporarily unavailable. Please try again.",
    );
    expect(result.current.errorMessage).not.toContain("boom");
    expect(result.current.errorDetails).toBe("boom");
  });

  it("maps a truly unmapped status (e.g. 418) to the generic fallback, raw text only in errorDetails (review-default branch)", () => {
    mockReviewState = {
      isPending: false,
      error: new ApiError("boom", 418),
    };
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBe(
      "Something went wrong. Please try again.",
    );
    expect(result.current.errorMessage).not.toContain("boom");
    expect(result.current.errorDetails).toBe("boom");
  });

  it("returns null errorMessage and errorDetails when there is no error", () => {
    const { result } = renderHook(() => useOriginationReview("7"));
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.errorDetails).toBeNull();
  });

  // ── Approve confirmation dialog (issue #838) ────────────────────────────────

  describe("approve confirmation dialog (issue #838)", () => {
    it("approveOpen defaults to false", () => {
      const { result } = renderHook(() => useOriginationReview("7"));
      expect(result.current.approveOpen).toBe(false);
    });

    it("openApprove() opens the dialog and resets a stale review error", () => {
      const { result } = renderHook(() => useOriginationReview("7"));
      act(() => result.current.openApprove());
      expect(result.current.approveOpen).toBe(true);
      expect(mockReset).toHaveBeenCalled();
    });

    it("cancelApprove() closes the dialog and resets the review mutation", () => {
      const { result } = renderHook(() => useOriginationReview("7"));
      act(() => result.current.openApprove());
      act(() => result.current.cancelApprove());
      expect(result.current.approveOpen).toBe(false);
      expect(mockReset).toHaveBeenCalled();
    });

    it("cancelApprove() resets the draw-loan mutation when the mint has NOT already succeeded", () => {
      mockDrawLoanState = {
        isPending: false,
        isSuccess: false,
        error: new Error("Signature cancelled"),
        stage: null,
      };
      const { result } = renderHook(() => useOriginationReview("7"));
      act(() => result.current.cancelApprove());
      expect(mockDrawLoanReset).toHaveBeenCalled();
    });

    it("cancelApprove() does NOT reset the draw-loan mutation once the mint already succeeded (idempotency guard)", () => {
      mockDrawLoanState = {
        isPending: false,
        isSuccess: true,
        error: null,
        stage: null,
      };
      mockReviewState = { isPending: false, error: new Error("boom") };
      const { result } = renderHook(() => useOriginationReview("7"));
      act(() => result.current.cancelApprove());
      expect(mockDrawLoanReset).not.toHaveBeenCalled();
    });

    it("Approve does not mint directly — mint fires only when approve() (the dialog's confirm action) is invoked", async () => {
      mockMutateAsync.mockResolvedValue({ hash: "tx-hash" });
      const { result } = renderHook(() => useOriginationReview("7"));

      act(() => result.current.openApprove());
      expect(mockMutateAsync).not.toHaveBeenCalled();
      expect(mockMutate).not.toHaveBeenCalled();

      await act(async () => {
        result.current.approve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockMutateAsync).toHaveBeenCalledWith({ loanData: LOAN_DATA });
      expect(mockMutate).toHaveBeenCalledWith(
        { id: 7, decision: "Approved" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it("the dialog closes automatically once the review call succeeds", async () => {
      mockMutateAsync.mockResolvedValue({ hash: "tx-hash" });
      mockMutate.mockImplementation((_input, opts) => {
        opts?.onSuccess?.();
      });
      const { result } = renderHook(() => useOriginationReview("7"));

      act(() => result.current.openApprove());
      expect(result.current.approveOpen).toBe(true);

      await act(async () => {
        result.current.approve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.approveOpen).toBe(false);
    });
  });
});

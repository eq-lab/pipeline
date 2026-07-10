/**
 * React Query mutation hook — wires the Trustee Approve/Reject controls
 * (issue #829, `/origination/$id`) to the existing backend endpoint
 * `POST /v1/loan-book/submissions/{id}/review`.
 *
 * Contract source of truth: `packages/api/src/routes/loan_book.rs`,
 * `review_submission` (unchanged by this issue):
 *   - Approve → `{ decision: "Approved" }`, **no** `reason` key at all
 *     (sending one → `400`).
 *   - Reject  → `{ decision: "Rejected", reason: "<non-empty>" }`
 *     (missing/empty → `400`).
 *   - Only `InReview` submissions are reviewable — an already-decided one
 *     → `409 Conflict`.
 *   - `401` missing/invalid/expired token (`ApiUnauthorizedError`); `403`
 *     caller lacks the `trustee` role; `200` on success with an empty body.
 *
 * `apiFetch` already injects `Authorization: Bearer <token>` (#791) and
 * throws a typed `ApiError` (carrying `.status`) on any non-2xx response
 * (#829) — callers map `.status` to user-facing copy (see
 * `-useOriginationReview.ts`).
 *
 * On success, invalidates every `["loan-submissions", ...]` query (React
 * Query matches by key prefix) so the `/origination` table and the
 * `/origination/$id` detail page both refetch and flip to the new status.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type ReviewDecision = "Approved" | "Rejected";

export interface ReviewSubmissionInput {
  id: number;
  decision: ReviewDecision;
  /** Required (non-empty) when `decision === "Rejected"`; must be omitted for "Approved". */
  reason?: string;
}

/**
 * `POST`s the review decision. The endpoint returns `200` with no JSON body
 * on success, so the promise resolves to `void` — never attempt to parse a
 * response body as a `SubmissionView`.
 */
async function postReview(input: ReviewSubmissionInput): Promise<void> {
  const body: { decision: ReviewDecision; reason?: string } = {
    decision: input.decision,
  };
  if (input.decision === "Rejected") {
    body.reason = input.reason;
  }

  await apiFetch<unknown>(`/v1/loan-book/submissions/${input.id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Mutation hook for approving/rejecting a loan submission. Mirrors the
 * `auth.ts` POST pattern over `apiFetch`. Exposes the standard React Query
 * mutation surface the page orchestration hook composes.
 */
export function useReviewSubmission() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ReviewSubmissionInput>({
    mutationFn: postReview,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loan-submissions"] });
    },
  });
}

/**
 * React Query mutation hook — wires the Trustee Approve/Reject controls
 * (`/origination/$id`) to the existing backend endpoint
 * `POST /v1/loan-book/submissions/{id}/review`.
 *
 * spec: docs/frontend/trustee-flows.md#review-error-copy (contract,
 * status-code → copy mapping, cache invalidation).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type ReviewDecision = "Approved" | "Rejected" | "ChangesRequested";

export interface ReviewSubmissionInput {
  id: number;
  decision: ReviewDecision;
  /**
   * Required (non-empty) when `decision` is `"Rejected"` or
   * `"ChangesRequested"`; must be omitted for `"Approved"`.
   */
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
  if (input.decision === "Rejected" || input.decision === "ChangesRequested") {
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

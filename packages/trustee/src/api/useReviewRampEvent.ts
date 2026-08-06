/**
 * React Query mutation hook — wires the Trustee Approve/Reject controls on
 * the Cash Management On/Off-ramp review queue to
 * `POST /v1/ramp/events/{id}/review`. Mirrors `useReviewSubmission.ts`'s
 * contract shape (`loan_book::review_submission`).
 *
 * spec: docs/frontend/trustee-flows.md#onoff-ramp-tab.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

export type RampReviewDecision = "Approved" | "Rejected";

export interface ReviewRampEventInput {
  id: number;
  decision: RampReviewDecision;
  /** Required (non-empty) when `decision === "Rejected"`; omitted for "Approved". */
  reason?: string;
}

/**
 * `POST`s the review decision. The endpoint returns `200` with no JSON body on
 * success, so the promise resolves to `void`.
 */
async function postRampReview(input: ReviewRampEventInput): Promise<void> {
  const body: { decision: RampReviewDecision; reason?: string } = {
    decision: input.decision,
  };
  if (input.decision === "Rejected") {
    body.reason = input.reason;
  }

  const chainId = ENV.STELLAR_CHAIN_ID;
  await apiFetch<unknown>(
    `/v1/ramp/events/${input.id}/review?chain_id=${chainId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export interface UseReviewRampEventResult {
  review: (input: ReviewRampEventInput) => void;
  reviewAsync: (input: ReviewRampEventInput) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
  /** The id currently being reviewed (for per-row pending state), or `null`. */
  pendingId: number | null;
}

/** Mutation hook for approving/rejecting a pending ramp event. */
export function useReviewRampEvent(): UseReviewRampEventResult {
  const queryClient = useQueryClient();
  const mutation = useMutation<void, Error, ReviewRampEventInput>({
    mutationFn: postRampReview,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ramp-events"] });
    },
  });

  return {
    review: (input) => mutation.mutate(input),
    reviewAsync: (input) => mutation.mutateAsync(input),
    isPending: mutation.isPending,
    error: mutation.error,
    reset: () => mutation.reset(),
    pendingId: mutation.isPending ? (mutation.variables?.id ?? null) : null,
  };
}

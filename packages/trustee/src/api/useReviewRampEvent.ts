// spec: docs/frontend/trustee-flows.md#onoff-ramp-tab
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type RampReviewDecision = "Approved" | "Rejected";

export interface ReviewRampEventInput {
  id: number;
  decision: RampReviewDecision;
  reason?: string;
}

async function postRampReview(input: ReviewRampEventInput): Promise<void> {
  const body: { decision: RampReviewDecision; reason?: string } = {
    decision: input.decision,
  };
  if (input.decision === "Rejected") {
    body.reason = input.reason;
  }

  await apiFetch<unknown>(`/v1/ramp/events/${input.id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface UseReviewRampEventResult {
  review: (input: ReviewRampEventInput) => void;
  reviewAsync: (input: ReviewRampEventInput) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
  pendingId: number | null;
}

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

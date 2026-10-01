// spec: docs/frontend/trustee-flows.md#lp-counterparties
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";
import { lpFetch } from "./useLp";

export type KybDecision = "Passed" | "ChangesRequested" | "Failed";
export type DocumentDecision = "Verified" | "Rejected";
export interface LpReviewInput {
  id: number;
  documentId?: number;
  decision: KybDecision | DocumentDecision;
  reason?: string;
}

export function useReviewLp() {
  const client = useQueryClient();
  async function refresh(id: number) {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["lp", id] }),
      client.invalidateQueries({ queryKey: ["lps"] }),
    ]);
  }
  return useMutation<void, Error, LpReviewInput>({
    mutationFn: async ({ id, documentId, decision, reason }) => {
      const path =
        documentId === undefined
          ? `/v1/lps/${id}/kyb`
          : `/v1/lps/${id}/documents/${documentId}/review`;
      await lpFetch<unknown>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          ...(decision !== "Verified" && reason?.trim()
            ? { reason: reason.trim() }
            : {}),
        }),
      });
    },
    onSuccess: (_, input) => refresh(input.id),
    onError: async (error, input) => {
      if (error instanceof ApiError && [404, 409].includes(error.status))
        await refresh(input.id);
    },
  });
}

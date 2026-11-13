// spec: docs/frontend/trustee-flows.md#amend-and-resubmit-originationidedit-1913
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { SubmitLoanInput, SubmitLoanResponse } from "./useSubmitLoan";

export interface ResubmitLoanVariables {
  id: number;
  input: SubmitLoanInput;
}

async function postResubmit({
  id,
  input,
}: ResubmitLoanVariables): Promise<SubmitLoanResponse> {
  return apiFetch<SubmitLoanResponse>(
    `/v1/loan-book/submissions/${id}/resubmit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function useResubmitLoan() {
  const queryClient = useQueryClient();

  return useMutation<SubmitLoanResponse, Error, ResubmitLoanVariables>({
    mutationFn: postResubmit,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["loan-submissions"] }),
  });
}

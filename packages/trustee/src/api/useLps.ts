// spec: docs/frontend/trustee-flows.md#lp-counterparties.
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { lpFetch } from "./useLp";

export interface LpSummary {
  id: number;
  legal_name: string;
  country: string | null;
  contact_email: string;
  stellar_address: string | null;
  address_linked_at: string | null;
  stellar_signer_address: string | null;
  evm_address: string | null;
  evm_signer_address: string | null;
  evm_address_linked_at: string | null;
  kyb_status: string;
  kyb_submitted_at?: string | null;
  kyb_decided_at?: string | null;
  owner_account_id: string;
  created_at: string;
}

export interface LpsResponse {
  lps: LpSummary[];
}

export interface UseLpsResult {
  data: LpsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useLps(): UseLpsResult {
  const query = useQuery<LpsResponse, Error>({
    queryKey: ["lps"],
    queryFn: () => apiFetch<LpsResponse>("/v1/lps"),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

export function fetchLpsByPaymentDetails(
  ref: string,
  signal?: AbortSignal,
): Promise<LpsResponse> {
  const value = ref.trim();
  if (!value) {
    return Promise.reject(new Error("A payment reference is required."));
  }
  return lpFetch<LpsResponse>(
    `/v1/lps?payment_details=${encodeURIComponent(value)}`,
    { signal },
  );
}

export function useFindLpByPaymentDetails() {
  return useMutation<LpsResponse, Error, string>({
    mutationFn: (ref) => fetchLpsByPaymentDetails(ref),
  });
}

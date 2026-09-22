// spec: docs/frontend/trustee-flows.md#lp-counterparties.
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface LpResponse {
  id: number;
  legal_name: string;
  country: string | null;
  contact_email: string;
  stellar_address: string | null;
  address_linked_at: string | null;
  kyb_status: string;
  owner_chain_id: number;
  owner_address: string;
  created_at: string;
}

export interface LpsResponse {
  lps: LpResponse[];
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

// spec: docs/frontend/trustee-flows.md#onoff-ramp-tab
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";
import { useSessionState } from "@/auth/sessionStore";

export interface RampAddressesResponse {
  ramp_addresses: string[];
}

export interface UseRampAddressesResult {
  data: RampAddressesResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useRampAddresses(): UseRampAddressesResult {
  const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID;
  const query = useQuery<RampAddressesResponse, Error>({
    queryKey: ["ramp-addresses", chainId],
    queryFn: () =>
      apiFetch<RampAddressesResponse>(`/v1/ramp/addresses?chain_id=${chainId}`),
    refetchInterval: 60_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

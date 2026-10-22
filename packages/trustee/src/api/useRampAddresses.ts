// spec: docs/frontend/trustee-flows.md#onoff-ramp-tab (ramp addresses; still Stellar-hardcoded, TD-153).
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

/** Shape of the `GET /v1/ramp/addresses` response. */
export interface RampAddressesResponse {
  /** The chain's configured ramp addresses (Strkeys); empty when unconfigured. */
  ramp_addresses: string[];
}

export interface UseRampAddressesResult {
  data: RampAddressesResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Fetches the configured ramp addresses for the Stellar chain. */
export function useRampAddresses(): UseRampAddressesResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
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

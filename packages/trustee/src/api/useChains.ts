// spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100 (served chains, #1667).
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  servedTargetChains,
  type ServedTargetChains,
} from "@/lib/targetChains";
import { apiFetch } from "./client";

export interface ChainItem {
  chain_id: number;
  kind: "evm" | "stellar";
}

export interface ChainsResponse {
  chains: ChainItem[];
  default_chain_id: number;
}

export function useChains(): UseQueryResult<ChainsResponse, Error> {
  return useQuery<ChainsResponse, Error>({
    queryKey: ["chains"],
    queryFn: () => apiFetch<ChainsResponse>("/v1/chains"),
    staleTime: Infinity,
    retry: false,
  });
}

export function useServedTargetChains(): ServedTargetChains {
  const query = useChains();
  return servedTargetChains(query.status, query.data);
}

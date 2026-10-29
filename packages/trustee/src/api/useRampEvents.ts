// spec: docs/frontend/trustee-flows.md#onoff-ramp-tab
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";
import { useSessionState } from "@/auth/sessionStore";

export type RampEventType = "OnRamp" | "OffRamp";

export interface RampEvent {
  id: number;
  chain_id: number;
  type: RampEventType;
  to: string;
  from: string;
  amount: string;
  created_at: number;
}

export interface RampEventsResponse {
  events: RampEvent[];
}

export interface UseRampEventsResult {
  chainId: number;
  data: RampEventsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useRampEvents(): UseRampEventsResult {
  const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID;
  const query = useQuery<RampEventsResponse, Error>({
    queryKey: ["ramp-events", chainId],
    queryFn: () =>
      apiFetch<RampEventsResponse>(`/v1/ramp/events?chain_id=${chainId}`),
    refetchInterval: 30_000,
  });

  return {
    chainId,
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

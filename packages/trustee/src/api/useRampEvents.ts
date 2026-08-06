/**
 * React Query hook — the pending ramp-boundary review queue for the Trustee
 * Cash Management On/Off-ramp tab (`GET /v1/ramp/events`). Serves only
 * pending events; a reviewed (Approved or Rejected) event drops off the
 * list. Mirrors `useLoanBook.ts` conventions (TD-42 hand-mirror).
 *
 * spec: docs/frontend/trustee-flows.md#onoff-ramp-tab.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

/** Which leg of the custody/ramp boundary the transfer crossed. */
export type RampEventType = "OnRamp" | "OffRamp";

/** One pending ramp-boundary `AssetTransfer` event awaiting Trustee review. */
export interface RampEvent {
  /** `contract_logs.id` — pass to `POST /v1/ramp/events/{id}/review`. */
  id: number;
  /** `OnRamp` (ramp→custody) or `OffRamp` (custody→ramp). */
  type: RampEventType;
  /** Recipient Strkey. */
  to: string;
  /** Sender Strkey. */
  from: string;
  /** Transfer amount, canonical 6-decimal USDC base-units string. */
  amount: string;
  /** Unix seconds the transfer was recorded on-chain. */
  created_at: number;
}

/** Shape of the `GET /v1/ramp/events` response. */
export interface RampEventsResponse {
  /** Pending events only — a reviewed event drops off this list. */
  events: RampEvent[];
}

export interface UseRampEventsResult {
  data: RampEventsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetches the pending ramp-event review queue for the Stellar chain. Always
 * sends `chain_id=ENV.STELLAR_CHAIN_ID` (the Trustee app is Stellar-scoped).
 */
export function useRampEvents(): UseRampEventsResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
  const query = useQuery<RampEventsResponse, Error>({
    queryKey: ["ramp-events", chainId],
    queryFn: () =>
      apiFetch<RampEventsResponse>(`/v1/ramp/events?chain_id=${chainId}`),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

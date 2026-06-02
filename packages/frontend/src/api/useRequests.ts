/**
 * React Query hook — fetches the connected wallet's request history from the
 * Pipeline API (`GET /v1/requests?wallet=<address>`).
 *
 * Mock layer
 * ----------
 * The hook is reactive to changes in `pipeline.mock.api.GET./v1/requests*`
 * localStorage keys. When the mock bridge dispatches a `pipeline-mock:wallet`
 * event (any `pipeline.mock.*` write), the hook increments a version counter
 * that is included in the React Query `queryKey`, causing a fresh fetch.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 */
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useEvmWallet } from "@/wallet";
import { subscribeMock } from "@/wallet";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RequestStatus =
  | "PendingVerification"
  | "PendingClaim"
  | "Completed"
  | "VerificationFailed";

export type RequestType = "Deposit" | "Withdraw" | "Stake" | "Unstake";

export interface RequestItem {
  type: RequestType;
  /** Omitted for Stake / Unstake */
  request_id?: string;
  /** Raw bigint string: USDC = 6 dp for Deposit/Withdraw; PLUSD = 18 dp for Stake/Unstake */
  amount: string;
  /** Stake/Unstake only */
  assets?: string;
  /** Stake/Unstake only */
  shares?: string;
  status: RequestStatus;
  /** ISO-8601 UTC */
  created_at: string;
}

export interface RequestsResponse {
  requests: RequestItem[];
}

// ── Mock-version external store ────────────────────────────────────────────────
// A simple counter that increments on every `pipeline.mock.*` change. Including
// it in the React Query queryKey forces a fresh fetch when mock data changes.

let mockVersion = 0;
const mockListeners = new Set<() => void>();

function getMockVersion() {
  return mockVersion;
}

function subscribeMockVersion(listener: () => void) {
  return subscribeMock("pipeline.mock.api", () => {
    mockVersion += 1;
    // Notify React's useSyncExternalStore listener
    listener();
    // Also notify all other listeners (in case there are multiple)
    for (const l of mockListeners) {
      if (l !== listener) l();
    }
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseRequestsOptions {
  /** Polling interval in milliseconds. When provided, the query refetches on
   *  this cadence in addition to mock-key-change refetches. */
  refetchInterval?: number;
}

export interface UseRequestsResult {
  data: RequestsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Returns the connected wallet's request history.
 *
 * - Disabled when the wallet is disconnected (`enabled: false`).
 * - Refetches automatically when any `pipeline.mock.*` key changes (same-tab
 *   mock bridge) — keeps the DevTools console experience seamless.
 * - Pass `refetchInterval` to enable background polling (e.g. 60_000 for the
 *   deposit page state machine).
 */
export function useRequests(
  options: UseRequestsOptions = {},
): UseRequestsResult {
  const { address, isConnected } = useEvmWallet();

  // Subscribe to mock-key changes — version is included in queryKey to force
  // React Query to issue a fresh fetch when mock data is written.
  const mockVer = useSyncExternalStore(
    subscribeMockVersion,
    getMockVersion,
    getMockVersion,
  );

  const query = useQuery<RequestsResponse, Error>({
    queryKey: ["requests", address, mockVer],
    queryFn: () =>
      apiFetch<RequestsResponse>(`/v1/requests?wallet=${address ?? ""}`),
    enabled: isConnected && !!address,
    ...(options.refetchInterval !== undefined
      ? { refetchInterval: options.refetchInterval }
      : {}),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/**
 * React Query hook — fetches the Trustee Audit Log feed from the Pipeline API
 * (`GET /v1/audit-log`) for the **Audit Log** page (issue #1004, Figma node
 * `4116:13770`), Surface 17 of epic #775.
 *
 * Mirrors `useLoanBook.ts`'s conventions (queryKey shape, `apiFetch`,
 * `refetchInterval`, Stellar-scoped `chain_id`). The trustee app deliberately
 * does NOT depend on `@pipeline/frontend` (epic #775 keeps the two apps
 * separate), so the DTOs below are a self-contained port of the backend shape
 * (`packages/api/src/routes/audit_log.rs`, #1000) rather than an import — a
 * hand-mirroring alongside TD-42's existing trustee/LP pairs.
 *
 * On-chain only (v1): the endpoint serves indexed on-chain loan-lifecycle and
 * yield events only. Off-chain actions (fiat wire confirmations, MPC
 * co-signatures) are a backend follow-up and do not appear yet — the page
 * renders exactly what is served, never a fabricated row.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

/** What a log entry pertains to: a specific loan, or the protocol at large. */
export interface AuditScope {
  /**
   * On-chain loan id (decimal string) for loan-scoped events; `null` for
   * protocol-scoped events (e.g. `YieldMinted`). The frontend maps this to its
   * own friendly loan name; `label` is the server-side fallback.
   */
  loan_id: string | null;
  /** Human-readable scope label, e.g. `"Loan #4492"` or `"Protocol"`. */
  label: string;
}

/** One row of the Audit Log table. */
export interface AuditLogItem {
  /** Event time, ISO-8601 UTC (from the on-chain block timestamp). */
  timestamp: string;
  /** Server-rendered, human-readable description of the action. */
  action: string;
  /** What the action pertains to. */
  scope: AuditScope;
  /** On-chain reference — the transaction hash. */
  reference: string;
  /** Raw on-chain event name (e.g. `"PaymentRecorded"`). */
  event_name: string;
  /** Curated scalar fields backing `action` (amounts in decimal dollars). Shape varies by event. */
  details: Record<string, unknown>;
}

/** Shape of the `GET /v1/audit-log` response. Full feed, newest first, not paginated. */
export interface AuditLogResponse {
  items: AuditLogItem[];
}

/** Return value of `useAuditLog`. */
export interface UseAuditLogResult {
  data: AuditLogResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Returns the Trustee audit log feed (newest first).
 *
 * - Always sends `chain_id=ENV.STELLAR_CHAIN_ID` — the Trustee app is
 *   Stellar-scoped like the rest of its reads (`useLoanBook`).
 * - Polls every 30 s per the dashboard "Real-time updates" convention
 *   (`docs/FRONTEND.md`) so a new action appears at the top without a reload.
 */
export function useAuditLog(): UseAuditLogResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
  const query = useQuery<AuditLogResponse, Error>({
    queryKey: ["audit-log", chainId],
    queryFn: () =>
      apiFetch<AuditLogResponse>(`/v1/audit-log?chain_id=${chainId}`),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

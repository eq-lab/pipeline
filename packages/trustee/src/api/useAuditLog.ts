/**
 * React Query hook over `GET /v1/audit-log` for the Trustee Audit Log page
 * (issue #1004). The DTOs below are a self-contained hand-mirror of the backend
 * shape (`packages/api/src/routes/audit_log.rs`, #1000) — TD-42 convention, the
 * trustee app deliberately does not depend on `@pipeline/frontend`.
 *
 * spec: docs/frontend/trustee-flows.md#audit-log.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface AuditScope {
  // `loan_id`: null for protocol-scoped events (wire, ramp, cash-ledger, supply).
  loan_id: string | null;
  label: string;
}

export interface AuditLogItem {
  chain_id: number;
  timestamp: string;
  action: string;
  scope: AuditScope;
  reference: string;
  event_name: string;
  // Curated scalars backing `action`; shape varies by event.
  details: Record<string, unknown>;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
}

export interface UseAuditLogResult {
  data: AuditLogResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAuditLog(): UseAuditLogResult {
  const query = useQuery<AuditLogResponse, Error>({
    queryKey: ["audit-log", "all"],
    queryFn: () => apiFetch<AuditLogResponse>("/v1/audit-log"),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

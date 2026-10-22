/**
 * Presentation hook for the Audit Log page (issue #1004) — keeps `audit-log.tsx`
 * JSX-only per `docs/FRONTEND.md` rule 2. Joins the feed (`useAuditLog`) with the
 * loan book (`useLoanBook`) for friendly scope names and maps items to rows.
 *
 * spec: docs/frontend/trustee-flows.md#audit-log (state/enrichment model).
 */
import { useMemo } from "react";
import { useAuditLog, type AuditLogItem } from "@/api/useAuditLog";
import { useLoanBook } from "@/api/useLoanBook";
import { loanRowKey } from "@/lib/loanRoute";
import { targetChainLabel } from "@/lib/targetChains";
import { formatAuditTimestamp } from "@/utils/formatDate";
import { toUserError } from "@/utils/userError";

export interface AuditRow {
  key: string;
  time: string;
  chain: string;
  action: string;
  scopeLabel: string;
  reference: string;
}

export type AuditState = "loading" | "error" | "ready";

export interface UseAuditLogView {
  state: AuditState;
  errorMessage: string | null;
  errorDetails: string | null;
  rows: AuditRow[];
}

export function formatReference(reference: string): string {
  return reference.length > 0 ? reference : "—";
}

/** Friendly loan name when `(chain_id, loan_id)` is known, else the server fallback label. */
export function resolveScopeLabel(
  item: AuditLogItem,
  loanNames: Map<string, string>,
): string {
  if (item.scope.loan_id == null) return item.scope.label;
  return (
    loanNames.get(loanRowKey(item.chain_id, item.scope.loan_id)) ??
    item.scope.label
  );
}

export function buildAuditRows(
  items: AuditLogItem[],
  loanNames: Map<string, string>,
): AuditRow[] {
  return items.map((item, i) => ({
    key: `${item.chain_id}-${item.timestamp}-${item.event_name}-${i}`,
    time: formatAuditTimestamp(item.timestamp),
    chain: targetChainLabel(item.chain_id),
    action: item.action,
    scopeLabel: resolveScopeLabel(item, loanNames),
    reference: formatReference(item.reference),
  }));
}

export function useAuditLogView(): UseAuditLogView {
  const audit = useAuditLog();
  const loanBook = useLoanBook();

  const loanNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const loan of loanBook.data?.loans ?? []) {
      map.set(
        loanRowKey(loan.chain_id, loan.loan_id),
        `${loan.originator} — ${loan.commodity}`,
      );
    }
    return map;
  }, [loanBook.data]);

  const rows = useMemo<AuditRow[]>(
    () => buildAuditRows(audit.data?.items ?? [], loanNames),
    [audit.data, loanNames],
  );

  const state: AuditState = audit.error
    ? "error"
    : audit.isLoading && audit.data == null
      ? "loading"
      : "ready";

  const mapped = audit.error
    ? toUserError(audit.error, "Failed to load the audit log.")
    : null;

  return {
    state,
    errorMessage: mapped?.message ?? null,
    errorDetails: mapped?.details ?? null,
    rows,
  };
}

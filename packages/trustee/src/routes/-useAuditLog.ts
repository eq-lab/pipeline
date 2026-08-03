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
import { formatAuditTimestamp } from "@/utils/formatDate";

export interface AuditRow {
  key: string;
  time: string;
  action: string;
  scopeLabel: string;
  reference: string;
  referenceFull: string; // full tx hash, for the cell's `title` hover
}

export type AuditState = "loading" | "error" | "ready";

export interface UseAuditLogView {
  state: AuditState;
  errorMessage: string | null;
  rows: AuditRow[];
}

/** Truncate a tx hash to `"<first6>…<last4>"`; leave short strings untouched. */
export function truncateReference(reference: string): string {
  if (reference.length <= 12) return reference;
  return `${reference.slice(0, 6)}…${reference.slice(-4)}`;
}

/** Friendly loan name when the id is known, else the server fallback label. */
export function resolveScopeLabel(
  item: AuditLogItem,
  loanNames: Map<string, string>,
): string {
  if (item.scope.loan_id == null) return item.scope.label;
  return loanNames.get(item.scope.loan_id) ?? item.scope.label;
}

export function buildAuditRows(
  items: AuditLogItem[],
  loanNames: Map<string, string>,
): AuditRow[] {
  return items.map((item, i) => ({
    key: `${item.timestamp}-${item.reference}-${i}`,
    time: formatAuditTimestamp(item.timestamp),
    action: item.action,
    scopeLabel: resolveScopeLabel(item, loanNames),
    reference: truncateReference(item.reference),
    referenceFull: item.reference,
  }));
}

export function useAuditLogView(): UseAuditLogView {
  const audit = useAuditLog();
  const loanBook = useLoanBook();

  const loanNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const loan of loanBook.data?.loans ?? []) {
      map.set(loan.loan_id, `${loan.originator} — ${loan.commodity}`);
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

  return {
    state,
    errorMessage: audit.error?.message ?? null,
    rows,
  };
}

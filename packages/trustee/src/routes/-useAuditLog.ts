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

/** One rendered row of the Audit Log table. */
export interface AuditRow {
  /** Stable React key. */
  key: string;
  /** Time column, e.g. `"24 Jun 07:12"`. */
  time: string;
  /** Action column — the server-rendered human-readable description. */
  action: string;
  /** Loan / scope column — friendly loan name, or the server fallback label. */
  scopeLabel: string;
  /** Reference column — truncated tx hash, e.g. `"0xabc12…f4d9"`. */
  reference: string;
  /** Full tx hash, for the cell's `title` (hover) attribute. */
  referenceFull: string;
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

/**
 * Resolve a row's Loan / scope label: the friendly `"Originator — Commodity"`
 * name when the loan id is known, else the server-supplied fallback
 * (`"Loan #<id>"` for an unresolved loan, `"Protocol"` for a protocol event).
 */
export function resolveScopeLabel(
  item: AuditLogItem,
  loanNames: Map<string, string>,
): string {
  if (item.scope.loan_id == null) return item.scope.label;
  return loanNames.get(item.scope.loan_id) ?? item.scope.label;
}

/** Pure mapping from feed items (+ a loan-id→name map) to display rows. */
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

  /** loan_id → "Originator — Commodity" (the friendly name the design shows). */
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

// spec: docs/frontend/trustee-flows.md#needs-attention-section
import {
  normalizeOriginationSubmissionStatus,
  useLoanSubmissions,
} from "@/api/useLoanSubmissions";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { useLoanBook } from "@/api/useLoanBook";
import type { LoanBookEntry } from "@/api/useLoanBook";
import { formatSubmittedDate } from "@/utils/formatDate";
import { loanRowKey } from "@/lib/loanRoute";
import { targetChainLabel } from "@/lib/targetChains";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NeedsAttentionRow {
  id: number;
  title: string;
  subtitle: string;
  submission: SubmissionView;
}

export interface LoanNeedsAttentionRow {
  key: string;
  loanId: string;
  chainId: number;
  title: string;
  subtitle: string;
}

export type NeedsAttentionState = "loading" | "error" | "empty" | "ready";

export interface UseNeedsAttentionResult {
  state: NeedsAttentionState;
  errorMessage: string | null;
  rows: NeedsAttentionRow[];
  loanRows: LoanNeedsAttentionRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatCorridor(corridor: unknown): string | undefined {
  const raw = safeString(corridor);
  return raw?.replace(/\s*-\s*/g, " → ");
}

export function mapSubmissionToNeedsAttentionRow(
  submission: SubmissionView,
): NeedsAttentionRow {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};

  const friendlyOriginator = safeString(loanData.originator) ?? "—";
  const commodity = safeString(loanData.commodity) ?? "—";
  const corridor = formatCorridor(loanData.corridor);
  const submitted = formatSubmittedDate(submission.created_at);

  const subtitleParts = [commodity, corridor, `submitted ${submitted}`].filter(
    (part): part is string => Boolean(part),
  );

  const statusSuffix =
    normalizeOriginationSubmissionStatus(submission.status) ===
    "ChangesRequested"
      ? "changes requested"
      : "new request";

  return {
    id: submission.id,
    title: `${friendlyOriginator} — ${commodity}: ${statusSuffix}`,
    subtitle: subtitleParts.join(" · "),
    submission,
  };
}

export function loanAttentionLabel(
  status: string,
  marginCallOpen: boolean | null | undefined = null,
): string | null {
  if (status === "Closed" || status === "Default") return null;
  let label: string | null = null;
  if (status === "WatchList" || status === "Watchlist") label = "Watchlist";
  if (status === "Past Due" || status === "Matured") label = "Matured";
  if (marginCallOpen !== true) return label;
  return label ? `${label} · margin call open` : "Margin call open";
}

export function mapLoanToNeedsAttentionRow(
  entry: LoanBookEntry,
  label: string,
): LoanNeedsAttentionRow {
  return {
    key: loanRowKey(entry.chain_id, entry.loan_id),
    loanId: entry.loan_id,
    chainId: entry.chain_id,
    title: `${safeString(entry.originator) ?? "—"} · ${safeString(entry.commodity) ?? "—"}`,
    subtitle: `${label} · loan #${entry.loan_id} · ${targetChainLabel(entry.chain_id)}`,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNeedsAttention(): UseNeedsAttentionResult {
  const submissions = useLoanSubmissions();
  const loanBook = useLoanBook();

  if (submissions.isLoading || loanBook.isLoading) {
    return { state: "loading", errorMessage: null, rows: [], loanRows: [] };
  }
  const error = submissions.error ?? loanBook.error;
  if (error) {
    return {
      state: "error",
      errorMessage: error.message,
      rows: [],
      loanRows: [],
    };
  }

  const rows = (submissions.data ?? [])
    .filter((submission) => {
      const status = normalizeOriginationSubmissionStatus(submission.status);
      return status === "InReview" || status === "ChangesRequested";
    })
    .map(mapSubmissionToNeedsAttentionRow);

  const loanRows = (loanBook.data?.loans ?? []).flatMap((entry) => {
    const label = loanAttentionLabel(entry.status, entry.margin_call_open);
    return label ? [mapLoanToNeedsAttentionRow(entry, label)] : [];
  });

  if (rows.length === 0 && loanRows.length === 0) {
    return { state: "empty", errorMessage: null, rows: [], loanRows: [] };
  }

  return { state: "ready", errorMessage: null, rows, loanRows };
}

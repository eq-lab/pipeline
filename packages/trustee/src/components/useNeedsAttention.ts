/**
 * Query-wiring + value→display mapping for the Overview page's "Needs
 * Attention" section. Per `docs/FRONTEND.md` Code structure rule 2, the
 * `.tsx` component is JSX/styling only; this hook owns the
 * `useLoanSubmissions({ status: "InReview" })` + `useLoanBook()` calls and
 * maps each into a display-ready row (mirrors `-useOriginationTable.ts`'s
 * `state` discriminant shape).
 *
 * spec: docs/frontend/trustee-flows.md#needs-attention-section (field
 * mapping, scope, empty/loading/error handling).
 */
import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { useLoanBook } from "@/api/useLoanBook";
import type { LoanBookEntry } from "@/api/useLoanBook";
import { formatSubmittedDate } from "@/utils/formatDate";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One formatted, display-ready Needs Attention row (Origination group). */
export interface NeedsAttentionRow {
  id: number;
  title: string;
  subtitle: string;
  /**
   * The source `SubmissionView`, threaded through so the Review button can
   * navigate to `/origination/$id` with it as router state (issue #821)
   * without a second lookup by `id`.
   */
  submission: SubmissionView;
}

/**
 * One Loans-group Needs Attention row (issue #867) — a live loan that is
 * **Watchlist** or **Matured**, linking to `/loans/$id`.
 */
export interface LoanNeedsAttentionRow {
  loanId: string;
  title: string;
  subtitle: string;
}

export type NeedsAttentionState = "loading" | "error" | "empty" | "ready";

export interface UseNeedsAttentionResult {
  state: NeedsAttentionState;
  errorMessage: string | null;
  /** Origination group — in-review submissions. */
  rows: NeedsAttentionRow[];
  /** Loans group — Watchlist + Matured loans (issue #867). */
  loanRows: LoanNeedsAttentionRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `"—"` for anything not a non-empty string — never fabricates a value. */
function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Renders the corridor with the Figma's arrow glyph in place of the stored
 * hyphen separator (same transform as `-useOriginationTable.ts`'s corridor
 * column). Returns `undefined` (not "—") when the source is missing, so the
 * caller can drop the segment from the joined subtitle cleanly.
 */
function formatCorridor(corridor: unknown): string | undefined {
  const raw = safeString(corridor);
  return raw?.replace(/\s*-\s*/g, " → ");
}

/**
 * Maps one in-review `SubmissionView` to a Needs Attention row. `loan_data`
 * is treated as loosely-typed (its wire type is `serde_json::Value`) — every
 * nested field access is guarded so a missing/malformed submission never
 * throws.
 */
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

  return {
    id: submission.id,
    title: `${friendlyOriginator} — ${commodity}: new request`,
    subtitle: subtitleParts.join(" · "),
    submission,
  };
}

/**
 * The Loans-group Needs Attention label for a served display status, or `null`
 * when the loan doesn't need attention. `WatchList` → Watchlist; the
 * past-maturity status (`Past Due`, and legacy `Matured`) → Matured (issue #867).
 */
export function loanAttentionLabel(status: string): string | null {
  if (status === "WatchList" || status === "Watchlist") return "Watchlist";
  if (status === "Past Due" || status === "Matured") return "Matured";
  return null;
}

/** Maps a needs-attention loan-book row to a Loans-group row (link → `/loans/$id`). */
export function mapLoanToNeedsAttentionRow(
  entry: LoanBookEntry,
  label: string,
): LoanNeedsAttentionRow {
  return {
    loanId: entry.loan_id,
    title: `${safeString(entry.originator) ?? "—"} · ${safeString(entry.commodity) ?? "—"}`,
    subtitle: `${label} · loan #${entry.loan_id}`,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires the Needs Attention section's two groups:
 *   - **Origination** — `useLoanSubmissions({ status: "InReview" })`.
 *   - **Loans** — `useLoanBook()` filtered to Watchlist + Matured (issue #867).
 *
 * Supplementary block: the view renders nothing while loading/error or when both
 * groups are empty. Both queries are read unconditionally (hook rules) before the
 * state is derived.
 */
export function useNeedsAttention(): UseNeedsAttentionResult {
  const submissions = useLoanSubmissions({ status: "InReview" });
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
    .filter((submission) => submission.status === "InReview")
    .map(mapSubmissionToNeedsAttentionRow);

  const loanRows = (loanBook.data?.loans ?? []).flatMap((entry) => {
    const label = loanAttentionLabel(entry.status);
    return label ? [mapLoanToNeedsAttentionRow(entry, label)] : [];
  });

  if (rows.length === 0 && loanRows.length === 0) {
    return { state: "empty", errorMessage: null, rows: [], loanRows: [] };
  }

  return { state: "ready", errorMessage: null, rows, loanRows };
}

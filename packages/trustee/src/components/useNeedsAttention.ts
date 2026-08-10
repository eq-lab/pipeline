/**
 * Query-wiring + value→display mapping for the Overview page's "Needs
 * Attention" section (issue #818, Figma node `4116:9004`). Two groups:
 *   - **Origination** — in-review + changes-requested submissions (#818, #1046).
 *   - **Loans** — Watchlist + Matured loans from `useLoanBook` (#867).
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` component is JSX/
 * styling only; this hook owns the `useLoanSubmissions()` + `useLoanBook()`
 * calls and maps each into a display-ready row so the view stays a pure render
 * function (and this mapping is unit-testable without a DOM). Mirrors
 * `-useOriginationTable.ts`'s `state` discriminant shape.
 *
 * The submissions fetch is deliberately UNFILTERED (#1046): the Origination
 * group needs `InReview` + `ChangesRequested`, but the backend's
 * `SubmissionsQuery.status` accepts a single status per request, so one
 * unfiltered call filtered client-side (via
 * `normalizeOriginationSubmissionStatus`, the origination table's #1044
 * pattern) beats two parallel filtered queries — one request, and it shares
 * the `["loan-submissions", chainId, "all"]` cache with `useOriginationTable`.
 *
 * ## Field mapping (resolved Open Questions, issue #818 comments)
 *
 *   - Title: `` `${friendlyOriginator} — ${commodity}: ${statusSuffix}` `` —
 *     the suffix is `"new request"` for `InReview` and `"changes requested"`
 *     for `ChangesRequested` (#1046, origination-table vocabulary); the
 *     `friendlyOriginator` is `loan_data.originator` (the friendly NAME, e.g.
 *     "Open Mineral") — NOT the top-level `SubmissionView.originator` (the
 *     authenticated submitter address). This is the opposite field choice
 *     from `-useOriginationTable.ts`'s Originator column, which intentionally
 *     uses the top-level field; both are correct for their own row shape.
 *   - Subtitle: `` `${commodity} · ${corridor} · submitted ${date}` ``
 *     (backed fields only — human-resolved OQ#2). The Figma subtitle also
 *     references the valuation mode and attached documents, neither of which
 *     is backed pre-mint (see `-useOriginationTable.ts`'s docs for why); those
 *     parts are omitted, not fabricated. The corridor uses the same
 *     hyphen→arrow transform as `-useOriginationTable.ts` (`"PE-CN"` →
 *     `"PE → CN"`); any missing segment is dropped cleanly rather than
 *     rendered as a bare "—" in the middle of the joined string.
 *   - Action: inert "Review" button — no wiring/navigation this issue
 *     (resolved OQ#1); rendered by the view, not modeled here.
 *
 * Every field is read defensively: `loan_data` is `serde_json::Value` on the
 * wire, so missing/malformed nested fields degrade to "—" rather than
 * fabricating or throwing (mirrors `mapSubmissionToRow`'s guards). The
 * Origination group keeps exactly the normalized statuses `InReview` and
 * `ChangesRequested`: backend merged/lifecycle statuses normalize to
 * `Approved` (#892) and belong on the Loans surfaces, and `Rejected` is a
 * terminal decision record with nothing left to act on. `ChangesRequested`
 * was originally excluded as originator-actionable (#949/#950); issue #1046
 * reversed that — an origination awaiting a resubmit must stay visible on the
 * Overview, with the reviewer reason readable on the `/origination/$id`
 * detail page (banner-only per #950) via the same "Review" link.
 */
import {
  normalizeOriginationSubmissionStatus,
  useLoanSubmissions,
} from "@/api/useLoanSubmissions";
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
  /** Origination group — in-review + changes-requested submissions (#1046). */
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
 * Maps one in-flight (`InReview` / `ChangesRequested`) `SubmissionView` to a
 * Needs Attention row. The title suffix is status-derived (#1046): "new
 * request" for `InReview`, "changes requested" for `ChangesRequested` (any
 * other status falls back to "new request", but the hook never passes one).
 * `loan_data` is treated as loosely-typed (its wire type is
 * `serde_json::Value`) — every nested field access is guarded so a
 * missing/malformed submission never throws.
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
 *   - **Origination** — unfiltered `useLoanSubmissions()`, kept to normalized
 *     `InReview` + `ChangesRequested` client-side (#1046; see the module doc
 *     for why the server-side single-status filter doesn't fit here).
 *   - **Loans** — `useLoanBook()` filtered to Watchlist + Matured (issue #867).
 *
 * Supplementary block: the view renders nothing while loading/error or when both
 * groups are empty. Both queries are read unconditionally (hook rules) before the
 * state is derived.
 */
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
    const label = loanAttentionLabel(entry.status);
    return label ? [mapLoanToNeedsAttentionRow(entry, label)] : [];
  });

  if (rows.length === 0 && loanRows.length === 0) {
    return { state: "empty", errorMessage: null, rows: [], loanRows: [] };
  }

  return { state: "ready", errorMessage: null, rows, loanRows };
}

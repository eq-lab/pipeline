/**
 * Query-wiring + value→display mapping for the Overview page's "Needs
 * Attention" section, Origination group ONLY (issue #818, Figma node
 * `4116:9004` section / `4116:9006`+`4116:9008` Origination group).
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` component is JSX/
 * styling only; this hook owns the `useLoanSubmissions({ status: "InReview" })`
 * call and maps each in-review `SubmissionView` into a display-ready row so
 * the view stays a pure render function (and this mapping is unit-testable
 * without a DOM). Mirrors `-useOriginationTable.ts`'s `state` discriminant
 * shape.
 *
 * ## Field mapping (resolved Open Questions, issue #818 comments)
 *
 *   - Title: `` `${friendlyOriginator} — ${commodity}: new request` `` where
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
 * fabricating or throwing (mirrors `mapSubmissionToRow`'s guards). Non-
 * `InReview` submissions are filtered out defensively even though the server
 * already applies `?status=InReview`.
 */
import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { formatSubmittedDate } from "@/utils/formatDate";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One formatted, display-ready Needs Attention row (Origination group). */
export interface NeedsAttentionRow {
  id: number;
  title: string;
  subtitle: string;
}

export type NeedsAttentionState = "loading" | "error" | "empty" | "ready";

export interface UseNeedsAttentionResult {
  state: NeedsAttentionState;
  errorMessage: string | null;
  rows: NeedsAttentionRow[];
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
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires `useLoanSubmissions({ status: "InReview" })` to the Needs Attention
 * (Origination group) display state. The `state` discriminant lets the view
 * render loading/error/empty/ready without repeating the precedence logic
 * (mirrors `useOriginationTable`'s pattern).
 */
export function useNeedsAttention(): UseNeedsAttentionResult {
  const { data, isLoading, error } = useLoanSubmissions({
    status: "InReview",
  });

  if (isLoading) {
    return { state: "loading", errorMessage: null, rows: [] };
  }
  if (error) {
    return { state: "error", errorMessage: error.message, rows: [] };
  }

  const inReview = (data ?? []).filter(
    (submission) => submission.status === "InReview",
  );

  if (inReview.length === 0) {
    return { state: "empty", errorMessage: null, rows: [] };
  }

  return {
    state: "ready",
    errorMessage: null,
    rows: inReview.map(mapSubmissionToNeedsAttentionRow),
  };
}

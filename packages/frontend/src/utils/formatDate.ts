/**
 * LP-frontend date formatters for the Protocol Dashboard's In-Origination
 * table (issue #814, Figma node `4116-9155` — the same field set as the
 * trustee Origination page, #813).
 *
 * Hand-mirrored, byte-for-byte, from the trustee app's
 * `packages/trustee/src/utils/formatDate.ts` — the two apps stay separate
 * per epic #775, so this is a deliberate duplicate, not a shared import.
 * See TD-42 (`docs/exec-plans/tech-debt-tracker.md`).
 *
 * Two distinct formats, per the Figma reference (node `4116:9155`):
 *   - Maturity: day + short month + full year, e.g. `"15 Dec 2026"`.
 *   - Submitted: day + short month only (no year), e.g. `"18 Jun"`.
 *
 * Both render `—` for missing/unparseable input — never fabricate a date.
 */

const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const DAY_MONTH: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
};

/**
 * Formats a Unix-seconds timestamp (`loan_data.economics.original_maturity_date`)
 * as `"15 Dec 2026"`.
 *
 * - `1765756800` → `"15 Dec 2025"` (example shape; exact day depends on TZ)
 * - `null | undefined` → `"—"`
 * - non-finite / non-numeric input → `"—"`
 */
export function formatMaturityDate(
  unixSeconds: number | null | undefined,
): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return "—";
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", DAY_MONTH_YEAR).format(date);
}

/**
 * Formats an RFC 3339 timestamp (`SubmissionView.created_at`) as `"18 Jun"`
 * (day + short month, no year).
 *
 * - `"2026-06-18T10:00:00Z"` → `"18 Jun"`
 * - `null | undefined` → `"—"`
 * - unparseable string → `"—"`
 */
export function formatSubmittedDate(
  rfc3339: string | null | undefined,
): string {
  if (rfc3339 == null) return "—";
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", DAY_MONTH).format(date);
}

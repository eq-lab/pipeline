/**
 * Trustee-local date formatters for the Origination page's submissions table
 * (issue #813). Mirrors the trustee-app convention set by `formatUsd.ts` —
 * self-contained, no `@pipeline/frontend` dependency (epic #775 keeps the two
 * apps separate).
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

/**
 * Formats an RFC 3339 timestamp as `"18 Jun 2026"` (day + short month + year) —
 * the loan-detail epoch range (`start_date → maturity_date`, issue #857). Keeps
 * the year, unlike `formatSubmittedDate`, since epoch maturities can be years out.
 *
 * - `"2026-06-18T18:17:37Z"` → `"18 Jun 2026"`
 * - `null | undefined` → `"—"`
 * - unparseable string → `"—"`
 */
export function formatEpochDate(rfc3339: string | null | undefined): string {
  if (rfc3339 == null) return "—";
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", DAY_MONTH_YEAR).format(date);
}

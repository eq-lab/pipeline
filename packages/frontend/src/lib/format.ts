/**
 * Token amount and timestamp formatting helpers.
 *
 * `formatTokenAmount` — generalises `formatUsdc` to any decimals.
 * `formatActivityTime` — formats ISO-8601 UTC timestamps for the activity feed.
 *
 * Both helpers are pure functions with no side-effects and no library imports
 * beyond `@/wallet` (for `formatUnits`).
 */
import { formatUnits } from "@/wallet";

// Shared Intl formatter — created once, not per call.
const tokenFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Whole-number Intl formatter (no fraction digits) — used for amounts where
// cents are irrelevant, e.g. the below-min banner subtitle ("1,000 USDC").
const tokenFormatterWhole = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formats a raw bigint (or decimal bigint string) into a human-readable
 * decimal string with exactly two fraction digits.
 *
 * Examples:
 *   formatTokenAmount(1_000_000n, 6)                       → "1.00"
 *   formatTokenAmount(1_000_000_000n, 6)                   → "1,000.00"
 *   formatTokenAmount(1_000_000_000_000_000_000_000n, 18)  → "1,000.00"
 *   formatTokenAmount("1000000", 6)                        → "1.00"
 *   formatTokenAmount(0n, 6)                               → "0.00"
 */
export function formatTokenAmount(
  raw: bigint | string,
  decimals: number,
): string {
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const float = parseFloat(formatUnits(value, decimals));
  return tokenFormatter.format(float);
}

/**
 * Same as `formatTokenAmount` but rounds to a whole number (no fraction
 * digits). Used where the design omits cents, e.g. "1,000 USDC".
 *
 * Examples:
 *   formatTokenAmountWhole(1_000_000_000n, 6)  → "1,000"
 *   formatTokenAmountWhole(1_500_000n, 6)       → "2"   (rounds half-up)
 */
export function formatTokenAmountWhole(
  raw: bigint | string,
  decimals: number,
): string {
  const value = typeof raw === "string" ? BigInt(raw) : raw;
  const float = parseFloat(formatUnits(value, decimals));
  return tokenFormatterWhole.format(float);
}

/**
 * Formats an ISO-8601 UTC timestamp into a short locale string such as
 * "Apr 17, 2:17 PM" in the user's local timezone.
 *
 * Returns "—" for invalid or unparseable input.
 *
 * The locale is pinned to "en-US" so all users see the designed format
 * (month-first, uppercase AM/PM) regardless of browser locale. The exact
 * output string is still timezone-dependent; tests should assert on the
 * *shape* (`/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/`) rather than
 * the exact string to avoid CI flakiness.
 */
export function formatActivityTime(iso: string): string {
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return "—";
  }
}

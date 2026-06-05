/**
 * USDC / ERC-20 parse and format helpers.
 *
 * Thin wrappers around viem's `parseUnits` / `formatUnits` that:
 *   - Accept `decimals: number | undefined` so callers can pass the dynamic
 *     value from `useToken().decimals` without branching on every call site.
 *   - Return safe sentinel values (`0n` / `"—"`) when decimals are not yet
 *     available or the input string is unparseable.
 *
 * `parseUnits` and `formatUnits` are re-exported from `@/wallet` (which lives
 * inside `src/wallet/` and is therefore allowed to import from `viem`). The
 * `no-restricted-imports` ESLint rule forbids direct viem imports outside
 * `src/wallet/**`, so we consume them through the wallet module boundary.
 */
import { parseUnits } from "@/wallet";
import { formatTokenAmount, formatTokenAmountWhole } from "./format";

/**
 * Parses a raw decimal string (e.g. `"1000"`, `"1000.50"`) into a bigint
 * representation at `decimals` precision.
 *
 * Returns `0n` when:
 *   - `decimals` is `undefined` (still loading)
 *   - `raw` is empty or whitespace-only
 *   - `raw` is not a valid number string (parseUnits throws)
 *
 * Negative values are clamped to `0n`.
 */
export function parseUsdc(raw: string, decimals: number | undefined): bigint {
  if (decimals === undefined) return 0n;
  const trimmed = raw.trim();
  if (!trimmed) return 0n;
  try {
    const parsed = parseUnits(trimmed, decimals);
    return parsed < 0n ? 0n : parsed;
  } catch {
    return 0n;
  }
}

/**
 * Formats a raw bigint (e.g. `1_000_000_000n`) into a human-readable decimal
 * string with two fraction digits (e.g. `"1,000.00"`).
 *
 * Returns `"—"` when `decimals` is `undefined`.
 *
 * No currency or token-symbol prefix/suffix is added — contrast with
 * `useToken().formattedBalance` which includes a leading `$`.
 */
export function formatUsdc(
  value: bigint,
  decimals: number | undefined,
): string {
  if (decimals === undefined) return "—";
  return formatTokenAmount(value, decimals);
}

/**
 * Same as `formatUsdc` but prefixes the result with `"$"`.
 * Used for quick-amount chip labels (`"$1,000.00 (Min)"`).
 *
 * Returns `"—"` when `decimals` is `undefined`.
 */
export function formatUsdcCurrency(
  value: bigint,
  decimals: number | undefined,
): string {
  if (decimals === undefined) return "—";
  return `$${formatUsdc(value, decimals)}`;
}

/**
 * Formats a raw bigint as a whole-number string (no `$`, no fraction digits).
 * Used where the design omits cents, e.g. the below-min banner subtitle
 * (`"Minimum amount — 1,000 USDC"`).
 *
 * Returns `"—"` when `decimals` is `undefined`.
 */
export function formatUsdcWhole(
  value: bigint,
  decimals: number | undefined,
): string {
  if (decimals === undefined) return "—";
  return formatTokenAmountWhole(value, decimals);
}

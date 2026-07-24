/**
 * Trustee-local Stellar SAC amount helpers. The trustee package intentionally
 * stays separate from `packages/frontend`, so these mirror the SAC 7-decimal
 * conversion behavior without importing LP wallet code.
 */

export const SAC_DECIMALS = 7;

const POSITIVE_DECIMAL_RE = /^(?:\d+|\d*\.\d+)$/;

export function usdInputToSacBaseUnits(
  input: string | null | undefined,
  decimals: number = SAC_DECIMALS,
): string | null {
  const trimmed = input?.trim() ?? "";
  if (!POSITIVE_DECIMAL_RE.test(trimmed)) return null;

  const [wholeRaw = "0", fracRaw = ""] = trimmed.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
  const factor = 10n ** BigInt(decimals);
  const raw = BigInt(whole) * factor + BigInt(frac);

  return raw > 0n ? raw.toString() : null;
}

export function sacBaseUnitsToUsdDecimal(
  rawBaseUnits: string | null | undefined,
  decimals: number = SAC_DECIMALS,
): string | null {
  if (rawBaseUnits == null || !/^\d+$/.test(rawBaseUnits)) return null;

  const raw = BigInt(rawBaseUnits);
  const factor = 10n ** BigInt(decimals);
  const whole = raw / factor;
  const frac = raw % factor;
  return `${whole}.${frac.toString().padStart(decimals, "0")}`;
}

export function parsePositiveUsdInput(input: string): number | null {
  const decimal = usdInputToSacBaseUnits(input);
  if (decimal == null) return null;

  const n = Number(sacBaseUnitsToUsdDecimal(decimal));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Strips a decimal string's fractional suffix (base units always carry
 * `".000000"`) and converts the integer part from the on-chain 7-decimal
 * base-unit scale to a USD decimal string, via `sacBaseUnitsToUsdDecimal`.
 * BigInt-safe end to end — never `Number`/`parseFloat` on the raw base-unit
 * string, which can exceed `2^53`. Returns `null` for anything not a
 * well-formed non-negative decimal string.
 *
 * Used for the `/v1/loan-book/submissions` `loan_data.economics` monetary
 * fields (`original_facility_size` / `original_senior_tranche` /
 * `original_equity_tranche` / `original_offtaker_price`), which are served at
 * this 7-decimal base-unit scale (issue #912) — e.g. `"8000000000.000000"`
 * (8,000,000,000 base units) → `"800.0000000"` → formatted `$800` by
 * `formatFullUsd`.
 */
export function economicsBaseUnitsToUsdDecimal(
  raw: unknown,
  decimals: number = SAC_DECIMALS,
): string | null {
  if (typeof raw !== "string") return null;
  const intPart = /^(\d+)/.exec(raw.trim())?.[1];
  if (intPart == null) return null;
  return sacBaseUnitsToUsdDecimal(intPart, decimals);
}

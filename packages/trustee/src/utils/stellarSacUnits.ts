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

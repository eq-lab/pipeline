// spec: docs/frontend/trustee-flows.md#disburse-1898

export const SAC_DECIMALS = 7;

const POSITIVE_DECIMAL_RE = /^(?:\d+|\d*\.\d+)$/;

function scaleToRaw(whole: string, fraction: string, decimals: number): bigint {
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"))
  );
}

export function usdInputToSacBaseUnits(
  input: string | null | undefined,
  decimals: number = SAC_DECIMALS,
): string | null {
  const trimmed = (input ?? "").replace(/[$,\s]/g, "");
  if (!POSITIVE_DECIMAL_RE.test(trimmed)) return null;

  const [wholeRaw = "0", fracRaw = ""] = trimmed.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const raw = scaleToRaw(whole, fracRaw.slice(0, decimals), decimals);

  return raw > 0n ? raw.toString() : null;
}

export function parseExactAmount(
  input: string,
  decimals: number,
): bigint | null {
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimals}}))?$`).exec(
    input.trim(),
  );
  if (!match) return null;
  const [, whole = "0", fraction = ""] = match;
  const scaled = scaleToRaw(whole, fraction, decimals);
  return scaled > 0n ? scaled : null;
}

export function rawToDecimal(raw: string, decimals: number): string {
  const digits = raw.replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
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
 * Normalizes one of the `/v1/loan-book/submissions` `loan_data.economics`
 * monetary fields (`original_facility_size` / `original_senior_tranche` /
 * `original_equity_tranche` / `original_offtaker_price`) for the formatters.
 * These are human-unit USDC decimal strings (e.g. `"1200000.000000"` =
 * $1,200,000) — #1620 supersedes the #912 base-unit reading; the API serves
 * the on-chain base units in `draw_loan`. Returns the
 * trimmed string, or `null` for anything not a well-formed non-negative
 * decimal string.
 */
export function economicsUsdDecimal(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;
const MAX_FRACTION_DIGITS = 6;
const DECIMAL = /^\d+(?:\.\d+)?$/;

export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;
export const MAX_PERCENT = 1_000;
export const DEFAULT_RATE_SCALE = 10_000;

function splitDecimal(
  input: string,
  maxFraction: number,
): { digits: bigint; scale: bigint } | null {
  const trimmed = input.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const [whole = "", frac = ""] = trimmed.split(".");
  if (frac.length > maxFraction) return null;
  return {
    digits: BigInt(whole + frac),
    scale: 10n ** BigInt(frac.length),
  };
}

function scaledInteger(
  input: string,
  maxFraction: number,
  factor: bigint,
): bigint | null {
  const parts = splitDecimal(input, maxFraction);
  if (parts == null) return null;
  const total = parts.digits * factor;
  return total % parts.scale === 0n ? total / parts.scale : null;
}

export function percentToBpsStrict(input: string): number | null {
  const bps = scaledInteger(input, 2, 100n);
  if (bps == null || bps > BigInt(MAX_PERCENT * 100)) return null;
  return Number(bps);
}

export function percentToDefaultRate(input: string): number | null {
  const rate = scaledInteger(input, 4, BigInt(DEFAULT_RATE_SCALE));
  if (rate == null || rate > BigInt(U32_MAX)) return null;
  return Number(rate);
}

export function durationToSeconds(
  input: string,
  unitSeconds: number,
): string | null {
  const seconds = scaledInteger(
    input,
    MAX_FRACTION_DIGITS,
    BigInt(unitSeconds),
  );
  if (seconds == null || seconds > U64_MAX) return null;
  return seconds.toString();
}

function trimFraction(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

export function bpsToPercentText(bps: number): string {
  return trimFraction((bps / 100).toFixed(2));
}

export function defaultRateToPercentText(rate: number): string {
  return trimFraction((rate / DEFAULT_RATE_SCALE).toFixed(4));
}

export function secondsToUnitText(
  seconds: string,
  unitSeconds: number,
): string | null {
  if (!/^\d+$/.test(seconds)) return null;
  const total = BigInt(seconds);
  const unit = BigInt(unitSeconds);
  const whole = total / unit;
  const remainder = total % unit;
  const text =
    remainder === 0n
      ? whole.toString()
      : trimFraction(
          `${whole}.${((remainder * 10n ** BigInt(MAX_FRACTION_DIGITS)) / unit)
            .toString()
            .padStart(MAX_FRACTION_DIGITS, "0")}`,
        );
  return durationToSeconds(text, unitSeconds) === seconds ? text : null;
}

export function formatServedDuration(seconds: string | undefined): string {
  if (seconds == null || !/^\d+$/.test(seconds)) return "—";
  const total = BigInt(seconds);
  if (total === 0n) return "0 s";
  if (total % BigInt(SECONDS_PER_DAY) === 0n) {
    return `${total / BigInt(SECONDS_PER_DAY)} d`;
  }
  if (total % BigInt(SECONDS_PER_HOUR) === 0n) {
    return `${total / BigInt(SECONDS_PER_HOUR)} h`;
  }
  return `${seconds} s`;
}

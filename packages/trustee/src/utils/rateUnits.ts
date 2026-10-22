// spec: docs/frontend/trustee-flows.md#wired-actions
export const RATE_PERCENT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
export const MAX_RATE_BPS = 10_000;

export function percentToBps(input: string): number | null {
  const trimmed = input.trim();
  if (!RATE_PERCENT_PATTERN.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (bps <= 0 || bps > MAX_RATE_BPS) return null;
  return bps;
}

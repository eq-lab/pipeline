// spec: docs/frontend/dashboard-components.md#chartvalueaxis (Y-axis domain
// rule — served max bumped to the nearest even display value so the middle
// tick is exactly half, #1234/#1236; served average unused).

export interface AxisTicks {
  maxLabel: string;
  midLabel: string;
  bottomLabel: string;
}

export function formatAxisTickUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${Math.round(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function computeAxisTicks(
  max: number | null | undefined,
): AxisTicks | null {
  if (max == null || !Number.isFinite(max) || max <= 0) return null;
  const unit = max >= 1_000_000 ? 1_000_000 : max >= 1_000 ? 1_000 : 1;
  const suffix = unit === 1_000_000 ? "M" : unit === 1_000 ? "K" : "";
  let display = Math.round(max / unit);
  const halfRendersExactly = display === 1 && unit > 1;
  if (display % 2 !== 0 && !halfRendersExactly) display += 1;
  if (display === 0) display = 2;
  return {
    maxLabel: `$${display}${suffix}`,
    midLabel: halfRendersExactly
      ? formatAxisTickUsd(unit / 2)
      : `$${display / 2}${suffix}`,
    bottomLabel: "$0",
  };
}

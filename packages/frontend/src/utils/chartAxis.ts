// spec: docs/frontend/dashboard-components.md#chartvalueaxis (Y-axis domain
// rule per the 2026-09-10 change on issue #1234 — raw served max, middle tick
// fixed at max/2, served average unused).

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
  return {
    maxLabel: formatAxisTickUsd(max),
    midLabel: formatAxisTickUsd(max / 2),
    bottomLabel: formatAxisTickUsd(0),
  };
}

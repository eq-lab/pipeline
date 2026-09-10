// spec: docs/frontend/dashboard-components.md#chartvalueaxis (Y-axis domain
// rule per the 2026-09-10 resolutions on issue #1234 — no domain rounding).

export interface AxisTicks {
  maxLabel: string;
  avgLabel: string;
  avgFraction: number;
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
  average: number | null | undefined,
): AxisTicks | null {
  if (max == null || !Number.isFinite(max) || max <= 0) return null;
  const maxLabel = formatAxisTickUsd(max);
  const bottomLabel = formatAxisTickUsd(0);
  if (average == null || !Number.isFinite(average) || average < 0) {
    return { maxLabel, avgLabel: "—", avgFraction: 0.5, bottomLabel };
  }
  const avgFraction = Math.min(1, Math.max(0, average / max));
  return {
    maxLabel,
    avgLabel: formatAxisTickUsd(average),
    avgFraction,
    bottomLabel,
  };
}

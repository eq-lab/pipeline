// spec: docs/frontend/utils.md#frontend-utils

export function formatFractionPct(fraction: string | null | undefined): string {
  if (fraction == null) return "—";
  const num = parseFloat(fraction);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

// Limit clamping of tool inputs (specs/flex/limits.md).

export const clampLimit = (
  requested: number | undefined,
  max: number,
  fallback: number,
): number => Math.min(requested ?? fallback, max);

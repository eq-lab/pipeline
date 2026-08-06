import type { CcrTrend } from "./-useLoanDetail";

/**
 * The CCR-trend line-chart SVG, drawn from the real `/ccr-history` series.
 * Extracted from the Watchlist loan-detail page so it can be reused,
 * unwrapped, inside the Risk Council "Escalate to Default" ledger card.
 *
 * spec: docs/frontend/trustee-flows.md#ccr-trend-chart-watchlist-variant-figma-node-411610868,
 * docs/frontend/trustee-flows.md#escalate-to-default-flow-10--proposal-builder-not-a-typed-payload.
 */

const NEGATIVE_RED = "#b20000";
const INK_MUTED = "rgba(56,55,53,0.6)";
/** CCR-trend chart dashed guide-line colour (Figma `4116:10868`). */
const CCR_GUIDE = "rgba(178, 0, 0, 0.35)";

export function CcrTrendChart({ trend }: { trend: CcrTrend }) {
  // Plot area within the 440×124 viewBox.
  const X0 = 10;
  const X1 = 430;
  const Y_TOP = 8;
  const Y_BOTTOM = 92;

  const thresholdPcts = trend.thresholds.map((t) => t.pct);
  const allPcts = [...trend.points, ...thresholdPcts];
  const rawMin = Math.min(...allPcts);
  const rawMax = Math.max(...allPcts);
  // Pad the range 4% (or a flat 1 when the series is flat) so lines aren't flush
  // to the edges.
  const pad = rawMax > rawMin ? (rawMax - rawMin) * 0.08 : 1;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const scaleY = (pct: number) =>
    Y_BOTTOM - ((pct - yMin) / (yMax - yMin)) * (Y_BOTTOM - Y_TOP);
  const scaleX = (i: number) =>
    trend.points.length <= 1
      ? X1
      : X0 + (i / (trend.points.length - 1)) * (X1 - X0);

  const polyline = trend.points.map((p, i) => `${scaleX(i)},${scaleY(p)}`);
  const lastX = scaleX(trend.points.length - 1);
  const lastY = scaleY(trend.points[trend.points.length - 1]!);

  // Right-edge labels (current value + one per threshold) share the same x, so
  // when the loan's CCR sits far from the thresholds — squeezing 120% / 110%
  // together on the per-loan scale — their text would overprint. Lay them out
  // top→bottom with a minimum vertical gap, then shift the stack up if it would
  // spill past the viewBox bottom.
  const LABEL_GAP = 13;
  const LABEL_MAX_Y = 122;
  const rightLabels = [
    {
      text: trend.currentLabel,
      fontSize: 13.4,
      fontWeight: 700,
      y: lastY + 13,
    },
    ...trend.thresholds.map((t) => ({
      text: t.label,
      fontSize: 10.5,
      fontWeight: 400,
      y: scaleY(t.pct),
    })),
  ].sort((a, b) => a.y - b.y);
  for (let i = 1; i < rightLabels.length; i++) {
    const minY = rightLabels[i - 1]!.y + LABEL_GAP;
    if (rightLabels[i]!.y < minY) rightLabels[i]!.y = minY;
  }
  const overflow = rightLabels[rightLabels.length - 1]!.y - LABEL_MAX_Y;
  if (overflow > 0) for (const l of rightLabels) l.y -= overflow;

  return (
    <svg
      viewBox="0 0 440 124"
      className="w-full"
      role="img"
      aria-label={`CCR trend, currently ${trend.currentLabel}`}
    >
      {/* Dashed threshold guide lines, drawn at their true scaled y. */}
      {trend.thresholds.map((t) => (
        <line
          key={t.pct}
          x1={X0}
          y1={scaleY(t.pct)}
          x2={X1}
          y2={scaleY(t.pct)}
          stroke={CCR_GUIDE}
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      ))}
      {/* CCR line (or a lone dot for a single point) + current dot. */}
      {polyline.length > 1 && (
        <polyline
          points={polyline.join(" ")}
          fill="none"
          stroke={NEGATIVE_RED}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <circle cx={lastX} cy={lastY} r="4" fill={NEGATIVE_RED} />
      {/* Current value (bold) + threshold labels, laid out without overlap. */}
      {rightLabels.map((l, i) => (
        <text
          key={i}
          x={X1 - 2}
          y={l.y}
          textAnchor="end"
          fontFamily="var(--font-body)"
          fontSize={l.fontSize}
          fontWeight={l.fontWeight}
          fill={NEGATIVE_RED}
        >
          {l.text}
        </text>
      ))}
      {/* Series-start caption (bottom-left). */}
      <text
        x={X0}
        y="115"
        fontFamily="var(--font-body)"
        fontSize="12.4"
        fill={INK_MUTED}
      >
        {trend.startLabel}
      </text>
    </svg>
  );
}

import React from "react";
import { Link } from "@tanstack/react-router";
import { Card, SegmentedTabs } from "@pipeline/ui";
import {
  N,
  DEFAULT_PERIOD_ID,
  formatMoney,
  formatTime,
  usePortfolioChart,
} from "./usePortfolioChart";
import { ChartDatesRow } from "./ChartDatesRow";
import { formatAxisDateRange } from "@/utils/formatDate";
import type { ChartSeries } from "./usePortfolioChart";

/**
 * Total Balance card (Figma node 1497:95048) — balance/PnL header plus the
 * served sPLUSD history chart (#1138), falling back to the flat zero-value
 * placeholder when no series is available (#1114).
 * spec: docs/frontend/dashboard-components.md#portfolioplaceholdercard.
 */

export type MobileHomeState = "empty" | "plusd" | "splusd";

export interface PortfolioPlaceholderCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  mobileHomeState?: MobileHomeState;
  balanceLabel?: string;
  unrealizedPnlLabel?: string;
  activePeriodId?: string;
  onActivePeriodChange?: (id: string) => void;
  series?: ChartSeries | null;
}

const HEADING_ID_BASE = "portfolio-placeholder-card-title";

const TABS = [
  { id: "7d", label: "7D" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
];

const VB_W = 680;
const VB_H = 120;
const TOOLTIP_HALF = 70;
const PLACEHOLDER_BAR_H = 8;
const PLACEHOLDER_FILL = "#D5D8C8";

function slotCentreX(idx: number, count: number): number {
  const slotW = VB_W / count;
  return idx * slotW + slotW / 2;
}

export const PortfolioPlaceholderCard = React.forwardRef<
  HTMLDivElement,
  PortfolioPlaceholderCardProps
>(function PortfolioPlaceholderCard(
  {
    className,
    mobileHomeState,
    balanceLabel = "$0.00",
    unrealizedPnlLabel = "$0.00 unrealized",
    activePeriodId,
    onActivePeriodChange,
    series: seriesProp,
    ...rest
  },
  ref,
) {
  const instanceId = React.useId();
  const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

  const [uncontrolledActiveId, setUncontrolledActiveId] =
    React.useState(DEFAULT_PERIOD_ID);
  const activeId = activePeriodId ?? uncontrolledActiveId;
  const setActiveId = onActivePeriodChange ?? setUncontrolledActiveId;

  const series = seriesProp ?? null;

  const {
    period,
    timestamps,
    slotCount,
    hoveredIdx,
    tooltip,
    onPointerMove,
    onPointerLeave,
  } = usePortfolioChart({ activeId, setActiveId, series });

  const wrapRef = React.useRef<HTMLDivElement>(null);

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!wrapRef.current) return;
      onPointerMove(e.clientX, wrapRef.current.getBoundingClientRect());
    },
    [onPointerMove],
  );

  const cursorLeftPct =
    hoveredIdx !== null
      ? ((slotCentreX(hoveredIdx, slotCount) / VB_W) * 100).toFixed(2)
      : "0";

  const periodLabel = TABS.find((t) => t.id === activeId)?.label ?? "7D";

  const composed = [
    "relative flex flex-col gap-6",
    "min-h-[274px] w-full",
    "overflow-hidden",
    "!border-t !border-r-[3px] !border-b-[3px] !border-l",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const barH = (PLACEHOLDER_BAR_H / 100) * VB_H;
  const y0 = VB_H - barH;

  return (
    <Card
      ref={ref}
      variant="yellow"
      role="region"
      aria-labelledby={HEADING_ID}
      className={composed}
      data-node-id="1497:95048"
      {...rest}
    >
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-start md:justify-between">
        <header className="flex flex-col gap-1">
          <span
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            Total Balance
          </span>

          <h2
            id={HEADING_ID}
            className={[
              "font-[family-name:var(--font-display)]",
              "text-[length:var(--text-pipeline-heading-m)]",
              "leading-[var(--text-pipeline-heading-m--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
          >
            {balanceLabel}
          </h2>

          <span
            data-testid="earning-caption"
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            {unrealizedPnlLabel}
          </span>

          {mobileHomeState === "splusd" ? null : (
            <Link
              to={mobileHomeState === "plusd" ? "/stake" : "/deposit"}
              search={
                mobileHomeState === "plusd"
                  ? { tab: "stake" as const }
                  : { direction: "deposit" as const }
              }
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-caption)]",
                "leading-[var(--text-pipeline-caption--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "underline-offset-2 hover:underline",
                "no-underline",
              ].join(" ")}
            >
              {mobileHomeState === "plusd"
                ? "Stake PLUSD to start earning"
                : "Get PLUSD to start"}
            </Link>
          )}
        </header>

        <SegmentedTabs
          tabs={TABS}
          activeId={activeId}
          onSelect={setActiveId}
          variant="floating"
          className="shrink-0"
        />
      </div>

      <div
        ref={wrapRef}
        className="relative flex-1"
        role="img"
        aria-label={`Total balance for ${periodLabel}: ${balanceLabel} (${unrealizedPnlLabel})`}
        data-node-id="1497:95048-chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={onPointerLeave}
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          {series !== null
            ? series.values.map((value, i) => {
                const cx = slotCentreX(i, slotCount);
                const maxValue = Math.max(...series.values);
                const h =
                  maxValue > 0
                    ? Math.max((value / maxValue) * VB_H * 0.9, barH * 0.3)
                    : barH * 0.3;
                const slotW = VB_W / slotCount;
                const spikeW = Math.min(1, Math.max(0.35, slotW * 0.25));
                const bandW = Math.min(3, Math.max(0.7, slotW * 0.6));
                return (
                  <g key={i} data-bar-slot={i}>
                    <rect
                      x={cx - spikeW / 2}
                      y={VB_H - h}
                      width={spikeW}
                      height={h}
                      fill="var(--color-pipeline-chart-positive)"
                    />
                    <rect
                      x={cx - bandW / 2}
                      y={VB_H - h * 0.4}
                      width={bandW}
                      height={h * 0.4}
                      fill="var(--color-pipeline-chart-positive)"
                    />
                  </g>
                );
              })
            : Array.from({ length: N }, (_, i) => {
                const cx = slotCentreX(i, N);
                return (
                  <g key={i} data-bar-slot={i}>
                    <rect
                      x={cx - 1.5}
                      y={y0}
                      width={3}
                      height={barH}
                      fill={PLACEHOLDER_FILL}
                      opacity={0.35}
                    />
                    <rect
                      x={cx - 1}
                      y={y0 + barH * 0.4}
                      width={2}
                      height={barH * 0.6}
                      fill={PLACEHOLDER_FILL}
                      opacity={0.65}
                    />
                    <rect
                      x={cx - 0.5}
                      y={y0 + barH * 0.7}
                      width={1}
                      height={barH * 0.3}
                      fill={PLACEHOLDER_FILL}
                      opacity={1}
                    />
                  </g>
                );
              })}
        </svg>

        {hoveredIdx !== null && (
          <div
            aria-hidden="true"
            style={{ left: `${cursorLeftPct}%` }}
            className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-[var(--color-pipeline-chart-positive)]"
          />
        )}

        <div
          aria-hidden={hoveredIdx === null}
          data-testid="chart-tooltip"
          style={{
            left:
              hoveredIdx !== null
                ? `clamp(${TOOLTIP_HALF}px, ${cursorLeftPct}%, calc(100% - ${TOOLTIP_HALF}px))`
                : "50%",
            opacity: hoveredIdx !== null ? 1 : 0,
            pointerEvents: "none",
          }}
          className={[
            "absolute bottom-full mb-2",
            "-translate-x-1/2",
            "rounded px-3 py-1.5",
            "bg-[var(--color-pipeline-ink)]",
            "text-[color:var(--color-pipeline-on-dark)]",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "whitespace-nowrap",
            "transition-opacity duration-75",
          ].join(" ")}
        >
          {tooltip !== null ? (
            <>
              <span className="block font-[var(--font-weight-medium)]">
                {formatMoney(tooltip.balance)}
              </span>
              <span className="block opacity-70">
                {formatTime(tooltip.timestamp, period.fmt)}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <ChartDatesRow
        {...formatAxisDateRange(
          timestamps[0],
          timestamps[timestamps.length - 1],
        )}
      />
    </Card>
  );
});

PortfolioPlaceholderCard.displayName = "PortfolioPlaceholderCard";

export default PortfolioPlaceholderCard;

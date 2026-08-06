/**
 * WithdrawalQueuePanel — Protocol Dashboard Panel C: Withdrawal Queue.
 *
 * spec: docs/frontend/dashboard-components.md#withdrawalqueuepanel
 * (content, layout, Figma bindings).
 */
import React from "react";
import { PanelContainer } from "./PanelContainer";
import { WithdrawalQueueTable } from "./WithdrawalQueueTable";
import { useWithdrawalQueuePanel } from "./useWithdrawalQueuePanel";

// ── Summary card ──────────────────────────────────────────────────────────────
// spec: docs/frontend/dashboard-components.md#withdrawalqueuepanel (summary card Figma tokens)
const cardClasses = [
  "flex flex-col justify-between",
  "bg-[color:var(--color-pipeline-surface)]",
  "border-t border-l border-b-[3px] border-r-[3px]",
  "border-[color:var(--color-pipeline-line)]",
  "rounded-[var(--radius-pipeline-card,4px)]",
  "p-4",
  "h-[144px]",
  "w-[200px] shrink-0 md:w-auto md:flex-1",
].join(" ");

const cardLabelClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body,16px)]",
  "leading-[20px]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

const cardValueClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[20px]",
  "leading-[28px]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

interface SummaryCardProps {
  label: React.ReactNode;
  value: string;
  "data-testid"?: string;
}

function SummaryCard({
  label,
  value,
  "data-testid": testId,
}: SummaryCardProps) {
  return (
    <div className={cardClasses} data-testid={testId}>
      <div className={cardLabelClasses}>{label}</div>
      <div className={cardValueClasses}>{value}</div>
    </div>
  );
}

// ── Show more button ──────────────────────────────────────────────────────────
const showMoreClasses = [
  "mt-2 w-full text-center",
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "hover:text-[color:var(--color-pipeline-ink)]",
  "transition-colors cursor-pointer py-2",
].join(" ");

// ── Panel ─────────────────────────────────────────────────────────────────────

export function WithdrawalQueuePanel() {
  const {
    state,
    summary,
    visibleRows,
    expanded,
    hasMore,
    showMore,
    errorMessage,
    refetch,
  } = useWithdrawalQueuePanel();

  return (
    <PanelContainer
      title="Withdrawal Queue"
      state={state}
      onRetry={refetch}
      errorMessage={errorMessage}
      // Borderless per Figma 3283:12101 — spec: docs/frontend/dashboard-components.md#withdrawalqueuepanel
      borderless
      data-testid="dashboard-panel-withdrawal-queue"
      data-node-id="3283:14893"
    >
      {/* Section spacing — spec: docs/frontend/dashboard-components.md#withdrawalqueuepanel */}
      <div className="flex flex-col gap-8">
        {/* Summary cards — spec: docs/frontend/dashboard-components.md#withdrawalqueuepanel */}
        <div className="w-full overflow-x-auto">
          <div
            className="flex items-stretch gap-4"
            data-testid="withdrawal-queue-summary-cards"
          >
            <SummaryCard
              label="In Queue"
              value={summary.inQueue}
              data-testid="withdrawal-queue-card-in-queue"
            />
            <SummaryCard
              label="Requests"
              value={summary.requests}
              data-testid="withdrawal-queue-card-requests"
            />
            <SummaryCard
              label="Estimated wait"
              value={summary.estimatedWait}
              data-testid="withdrawal-queue-card-estimated-wait"
            />
            <SummaryCard
              label="Liquid Cover"
              value={summary.liquidCover}
              data-testid="withdrawal-queue-card-liquid-cover"
            />
          </div>
        </div>

        {/* Table container — borderless per Figma 3283:12101 */}
        <div
          className="flex flex-col"
          data-testid="withdrawal-queue-table-container"
        >
          <WithdrawalQueueTable rows={visibleRows} />

          {/* "Show more" affordance — renders only when there are hidden rows */}
          {hasMore && !expanded && (
            <button
              type="button"
              className={showMoreClasses}
              onClick={showMore}
              data-testid="withdrawal-queue-show-more"
            >
              Show more
            </button>
          )}
        </div>
      </div>
    </PanelContainer>
  );
}

export default WithdrawalQueuePanel;

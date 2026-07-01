/**
 * WithdrawalQueuePanel — Protocol Dashboard Panel C: Withdrawal Queue.
 *
 * Wires the `useWithdrawalQueue` hook via the co-located
 * `useWithdrawalQueuePanel` logic hook (FRONTEND.md rule 2). The view here is
 * JSX-only; all formatting and state-machine logic lives in the hook.
 *
 * Content per Figma section `3283:14893`:
 *   - Title "Withdrawal Queue".
 *   - Four summary cards: In Queue / Requests / Estimated wait / Liquid Cover.
 *   - Table: Holder / Amount / Status (3 columns).
 *   - "Show more" affordance when there are more than 5 items (client-side).
 *
 * Figma:
 *   Desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14893
 *   Mobile:  https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72387
 *
 * Token discipline: no raw hex/font values.
 */
import React from "react";
import { PanelContainer } from "./PanelContainer";
import { WithdrawalQueueTable } from "./WithdrawalQueueTable";
import { useWithdrawalQueuePanel } from "./useWithdrawalQueuePanel";

// ── Summary card ──────────────────────────────────────────────────────────────

// Card surface: matches the LoanBookSummary card treatment —
// white surface, asymmetric depth border (1px top+left, 3px bottom+right),
// 4px radius, 16px padding, 144px tall (Figma frame 3283:14895 card height=144).
const cardClasses = [
  "flex flex-col justify-between",
  "bg-[color:var(--color-pipeline-surface)]",
  "border-t border-l border-b-[3px] border-r-[3px]",
  "border-[color:var(--color-pipeline-line)]",
  "rounded-[var(--radius-pipeline-card,4px)]",
  "p-4",
  "h-[144px]",
  "min-w-[160px]",
  "md:min-w-0",
].join(" ");

// Card label: Heading S token — body font, 16px/20px, regular weight.
const cardLabelClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body,16px)]",
  "leading-[20px]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// Card value: display serif, 20px/28px, regular weight.
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

// Caption-size, muted ink, minimal chrome — matches the panel's typographic
// scale for supplementary controls.
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
      data-testid="dashboard-panel-withdrawal-queue"
      data-node-id="3283:14893"
    >
      {/*
       * Spacing from Figma section 3283:14893:
       *   heading h=56, cards start y=88 → 32px heading→cards gap.
       *   PanelContainer contributes gap-4 (16px) between <h2> and body div.
       *   pt-4 (16px) on this wrapper adds the remaining 16px → 32px total.
       *   gap-8 (32px) between summary cards and table container:
       *   cards end y=232, table starts y=264 → 32px below cards.
       */}
      <div className="flex flex-col gap-8 pt-4">
        {/* Four summary cards — horizontally scrollable on mobile */}
        <div className="w-full overflow-x-auto">
          <div
            className={[
              "flex items-stretch gap-4",
              "md:grid md:grid-cols-4 md:items-stretch md:gap-4",
            ].join(" ")}
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

        {/* Table container — same bordered card as the Loan Book table container */}
        <div
          className={[
            "flex flex-col p-4",
            "bg-[color:var(--color-pipeline-surface)]",
            "rounded-[var(--radius-pipeline-card)]",
            "border-t border-l border-[color:var(--color-pipeline-line)]",
            "border-r-[3px] border-b-[3px] border-r-[color:var(--color-pipeline-line)] border-b-[color:var(--color-pipeline-line)]",
          ].join(" ")}
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

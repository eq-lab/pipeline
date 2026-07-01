/**
 * Co-located hook for `WithdrawalQueuePanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * Maps raw `useWithdrawalQueue` data → formatted summary cards + table rows +
 * panel state, so the view layer is pure JSX with no formatting logic.
 *
 * Row expand (resolved Open Question 2): the first 5 rows are visible by
 * default. `expanded` toggles the "Show more" affordance. The hook owns this
 * state so the view is JSX-only.
 */
import { useState } from "react";
import { useWithdrawalQueue } from "@/api";
import type { PanelState } from "./PanelContainer";
import { truncateAddress } from "@/utils/truncateAddress";
import {
  formatCompactUsd,
  formatCoverage,
  formatEstimatedWaitDays,
} from "@/utils/formatCompactUsd";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of rows visible before "Show more" is clicked. */
export const WITHDRAWAL_QUEUE_DEFAULT_VISIBLE = 5;

// ── Output types ──────────────────────────────────────────────────────────────

/** Pre-formatted summary card strings for `WithdrawalQueuePanel`. */
export interface WithdrawalQueueSummaryFormatted {
  /** e.g. `"$1.85M"` or `"—"` */
  inQueue: string;
  /** e.g. `"6"` or `"—"` */
  requests: string;
  /** e.g. `"~3.2 days"` or `"—"` */
  estimatedWait: string;
  /** e.g. `"5.6x"` or `"—"` (always `"—"` until the reserves endpoint exists) */
  liquidCover: string;
}

/** One pre-formatted withdrawal queue row. */
export interface WithdrawalQueueRow {
  /** Truncated account address, e.g. `"0x7a3f…3f1"`. */
  holder: string;
  /** Compact USD amount, e.g. `"$0.62M"`. */
  amount: string;
  /** API status verbatim: `"Queued"` or `"Completed"` (or an unexpected value). */
  status: string;
}

/** Shape returned by `useWithdrawalQueuePanel`. */
export interface WithdrawalQueuePanelState {
  state: PanelState;
  summary: WithdrawalQueueSummaryFormatted;
  /** Rows currently visible (first `WITHDRAWAL_QUEUE_DEFAULT_VISIBLE` when not expanded). */
  visibleRows: WithdrawalQueueRow[];
  /** Whether the user has expanded to see all rows. */
  expanded: boolean;
  /** True when there are more rows hidden behind "Show more". */
  hasMore: boolean;
  /** Call to expand the list (reveal all rows). */
  showMore: () => void;
  errorMessage: string | undefined;
  refetch: () => void;
}

// ── Empty fallbacks ───────────────────────────────────────────────────────────

const EMPTY_SUMMARY: WithdrawalQueueSummaryFormatted = {
  inQueue: "—",
  requests: "—",
  estimatedWait: "—",
  liquidCover: "—",
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Drives `WithdrawalQueuePanel`.
 *
 * - `loading` → panel shows `PanelLoading`.
 * - `error`   → panel shows `PanelError` with a retry action.
 * - `empty`   → no queue items; panel shows `PanelEmpty`.
 * - `ready`   → formatted summary + rows are available.
 *
 * Row expand: 5 rows visible by default; `showMore()` reveals all.
 */
export function useWithdrawalQueuePanel(): WithdrawalQueuePanelState {
  const { data, isLoading, error, refetch } = useWithdrawalQueue();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return {
      state: "loading",
      summary: EMPTY_SUMMARY,
      visibleRows: [],
      expanded: false,
      hasMore: false,
      showMore: () => setExpanded(true),
      errorMessage: undefined,
      refetch,
    };
  }

  if (error) {
    return {
      state: "error",
      summary: EMPTY_SUMMARY,
      visibleRows: [],
      expanded: false,
      hasMore: false,
      showMore: () => setExpanded(true),
      errorMessage: error.message,
      refetch,
    };
  }

  if (!data || data.items.length === 0) {
    return {
      state: "empty",
      summary: EMPTY_SUMMARY,
      visibleRows: [],
      expanded: false,
      hasMore: false,
      showMore: () => setExpanded(true),
      errorMessage: undefined,
      refetch,
    };
  }

  const allRows: WithdrawalQueueRow[] = data.items.map((item) => ({
    holder: truncateAddress(item.account),
    amount: formatCompactUsd(item.amount),
    status: item.status,
  }));

  const hasMore = allRows.length > WITHDRAWAL_QUEUE_DEFAULT_VISIBLE;
  const visibleRows = expanded
    ? allRows
    : allRows.slice(0, WITHDRAWAL_QUEUE_DEFAULT_VISIBLE);

  const summary: WithdrawalQueueSummaryFormatted = {
    inQueue: formatCompactUsd(data.summary.in_queue_usd),
    requests: String(data.summary.requests_count),
    estimatedWait: formatEstimatedWaitDays(data.summary.estimated_wait_days),
    liquidCover: formatCoverage(data.summary.liquid_cover),
  };

  return {
    state: "ready",
    summary,
    visibleRows,
    expanded,
    hasMore,
    showMore: () => setExpanded(true),
    errorMessage: undefined,
    refetch,
  };
}

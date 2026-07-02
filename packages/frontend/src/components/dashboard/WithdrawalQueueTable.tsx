/**
 * WithdrawalQueueTable — withdrawal queue table for Panel C.
 *
 * All viewports: a semantic `<table>` with 3 columns: Holder / Amount /
 *   Status. Wrapped in `overflow-x: auto` (FRONTEND.md wide-content rule).
 *
 *   The Figma XS mobile frame `3283-71053` renders a real 3-column table at
 *   mobile (Table container w=370, three ~115px `Item` columns) that fits
 *   within the 370px content area without horizontal scroll. The previous
 *   stacked-card `MobileCards` path has been removed to match Figma exactly
 *   (issue #749 resolved decision).
 *
 *   Spacing and typography follow the same conventions as `LoanBookTable`
 *   (Figma section `3283:14893`):
 *     Row height:    64px  (matching LoanBookTable row h=64)
 *     Row padding:   py-3  (12px top+bottom)
 *     Header gap:    pb-2  (8px after header)
 *     Row divider:   border-t 1px --color-pipeline-line-subtle on <td>
 *     Header caps:   12px/16px, font-normal, --color-pipeline-ink-muted
 *     Body cells:    16px/22px, font-normal, --color-pipeline-ink
 *
 *   Status colour:
 *     `Completed`  — green (`--color-pipeline-positive`) — the "done" state.
 *     `Queued`     — muted ink (`--color-pipeline-ink-muted`) — neutral/pending.
 *     Unknown      — muted ink (safe fallback).
 *
 * Figma references:
 *   Panel C desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14893
 *   Mobile (XS):     https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-71053
 *
 * Token discipline: no raw hex/font values.
 */

import type { WithdrawalQueueRow } from "./useWithdrawalQueuePanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WithdrawalQueueTableProps {
  rows: WithdrawalQueueRow[];
}

// ── Token class constants ─────────────────────────────────────────────────────

// Column-header cells: 12px/16px caption token.
// `pb-2` provides the 8px gap between header text and first body row.
const headerCellClasses = [
  "text-left",
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "pb-2",
  "border-b border-[color:var(--color-pipeline-line-subtle)]",
  "whitespace-nowrap",
  "overflow-hidden",
].join(" ");

// Body cells — py-3 (12px) row layer.
const bodyCellClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
  "py-3",
  "whitespace-nowrap",
  "border-t border-[color:var(--color-pipeline-line-subtle)]",
].join(" ");

// Cell inner wrapper: py-2 (8px) second padding layer.
const bodyCellInnerClasses = "block py-2";

// First column (Holder): allow truncation of long addresses.
const firstBodyCellClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
  "py-3",
  "overflow-hidden",
  "max-w-0",
  "border-t border-[color:var(--color-pipeline-line-subtle)]",
].join(" ");

const firstBodyCellInnerClasses = "block truncate py-2";

// ── Status badge ─────────────────────────────────────────────────────────────

/**
 * Returns the Tailwind class for the status text colour.
 *
 * - `Completed` → green (`--color-pipeline-positive`): the "done" state.
 * - `Queued`    → muted (`--color-pipeline-ink-muted`): neutral/pending.
 * - Unknown     → muted (safe fallback).
 */
function statusColorClass(status: string): string {
  if (status === "Completed") {
    return "text-[color:var(--color-pipeline-positive)]";
  }
  return "text-[color:var(--color-pipeline-ink-muted)]";
}

// ── Table (all viewports) ─────────────────────────────────────────────────────

function QueueTable({ rows }: WithdrawalQueueTableProps) {
  return (
    <div
      className="w-full overflow-x-auto"
      data-testid="withdrawal-queue-table-desktop"
    >
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {/* Three equal columns (~1/3 each), matching the Figma flex-1
              distribution for Holder / Amount / Status. */}
          <col style={{ width: "33.333%" }} />
          <col style={{ width: "33.333%" }} />
          <col style={{ width: "33.334%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className={[headerCellClasses, "pr-3"].join(" ")}>Holder</th>
            <th className={headerCellClasses}>Amount</th>
            <th className={headerCellClasses}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className={[firstBodyCellClasses, "pr-3"].join(" ")}>
                <span className={firstBodyCellInnerClasses}>{row.holder}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.amount}</span>
              </td>
              <td className={bodyCellClasses}>
                <span
                  className={[
                    bodyCellInnerClasses,
                    statusColorClass(row.status),
                  ].join(" ")}
                >
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── WithdrawalQueueTable ──────────────────────────────────────────────────────

/**
 * Renders the withdrawal queue table at all viewport widths.
 *
 * Mobile (below `md`): the 3-column table fits the 370px content area per
 * Figma XS frame `3283-71053` (three ~115px `Item` columns). The previous
 * stacked-card `MobileCards` path has been removed (issue #749 resolved
 * decision).
 *
 * Desktop (`md+`): same table, full width.
 */
export function WithdrawalQueueTable({ rows }: WithdrawalQueueTableProps) {
  return (
    <div data-testid="withdrawal-queue-table">
      <QueueTable rows={rows} />
    </div>
  );
}

export default WithdrawalQueueTable;

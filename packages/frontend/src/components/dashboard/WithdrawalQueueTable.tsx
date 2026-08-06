/**
 * WithdrawalQueueTable — withdrawal queue table for Panel C.
 *
 * spec: docs/frontend/dashboard-components.md#withdrawalqueuetable
 * (columns, mobile behavior, spacing/typography, status color).
 */

import type { WithdrawalQueueRow } from "./useWithdrawalQueuePanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WithdrawalQueueTableProps {
  rows: WithdrawalQueueRow[];
}

// ── Token class constants ─────────────────────────────────────────────────────
// spec: docs/frontend/dashboard-components.md#withdrawalqueuetable (cell spacing/typography)
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

const bodyCellInnerClasses = "block";

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

const firstBodyCellInnerClasses = "block truncate";

// ── Status badge ─────────────────────────────────────────────────────────────
// spec: docs/frontend/dashboard-components.md#withdrawalqueuetable (status color mapping)
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
          {/* Three equal columns, matching Figma flex-1 distribution. */}
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
 * spec: docs/frontend/dashboard-components.md#withdrawalqueuetable (mobile/desktop behavior).
 */
export function WithdrawalQueueTable({ rows }: WithdrawalQueueTableProps) {
  return (
    <div data-testid="withdrawal-queue-table">
      <QueueTable rows={rows} />
    </div>
  );
}

export default WithdrawalQueueTable;

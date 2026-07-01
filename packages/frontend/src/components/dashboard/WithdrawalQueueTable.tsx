/**
 * WithdrawalQueueTable — responsive withdrawal queue table for Panel C.
 *
 * Desktop (`md+`): a semantic `<table>` with 3 columns: Holder / Amount /
 *   Status. Wrapped in `overflow-x: auto` so it never forces horizontal page
 *   scroll (FRONTEND.md wide-content rule).
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
 *   Status colour (resolved Open Question 1):
 *     `Completed` — green (`--color-pipeline-positive`) — the "done" state.
 *     `Queued`    — muted ink (`--color-pipeline-ink-muted`) — neutral/pending.
 *     Unknown status — muted ink (safe fallback).
 *
 * Mobile (below `md`): each request rendered as a stacked card of label/value
 *   pairs with a divider between rows.
 *
 * Figma references:
 *   Panel C desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14893
 *   Mobile:          https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72387
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

// Mobile card label
const mobileLabelClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body-s,14px)]",
  "leading-[var(--text-pipeline-body-s--line-height,20px)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

// Mobile card value
const mobileValueClasses = [
  "font-[family-name:var(--font-body)]",
  "font-medium",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

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

// ── Desktop table ─────────────────────────────────────────────────────────────

function DesktopTable({ rows }: WithdrawalQueueTableProps) {
  return (
    <div
      className="hidden w-full overflow-x-auto md:block"
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

// ── Mobile stacked cards ──────────────────────────────────────────────────────

function MobileCards({ rows }: WithdrawalQueueTableProps) {
  return (
    <div
      className="block flex flex-col divide-y divide-[color:var(--color-pipeline-line)] md:hidden"
      data-testid="withdrawal-queue-table-mobile"
    >
      {rows.map((row, i) => (
        <div key={i} className="flex flex-col gap-2 py-4">
          {/* Primary row: holder address */}
          <div className={mobileValueClasses}>{row.holder}</div>
          {/* Grid of label/value pairs */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <MobileField label="Amount" value={row.amount} />
            <MobileField
              label="Status"
              value={row.status}
              valueClassName={statusColorClass(row.status)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MobileField({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={mobileLabelClasses}>{label}</span>
      <span
        className={[mobileValueClasses, valueClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

// ── WithdrawalQueueTable (both breakpoints) ───────────────────────────────────

/**
 * Renders the withdrawal queue table. Switches between desktop `<table>` (md+)
 * and stacked mobile cards (below md) automatically via Tailwind breakpoints.
 */
export function WithdrawalQueueTable({ rows }: WithdrawalQueueTableProps) {
  return (
    <div data-testid="withdrawal-queue-table">
      <DesktopTable rows={rows} />
      <MobileCards rows={rows} />
    </div>
  );
}

export default WithdrawalQueueTable;

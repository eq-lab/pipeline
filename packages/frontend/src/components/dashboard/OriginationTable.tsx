/**
 * OriginationTable — the In-Origination tab's submissions table for the Loan
 * Book panel (issue #814, Figma node `4116-9155` — the same field set as the
 * trustee Origination page, #813).
 *
 * Eight columns: Originator · Commodity · Facility · Corridor · Rate ·
 * Maturity · Submitted · Status. Rows come pre-formatted from
 * `mapSubmissionToRow` (`originationRow.ts`) via `useDeploymentMonitorPanel`.
 *
 * Per issue #814's resolved Open Questions (human-confirmed):
 *   1. The "Commodity · valuation" sub-line is OMITTED — no valuation-mode
 *      source exists for pre-mint submissions (mirrors #813).
 *   2. Status renders as the dashboard's existing simple color-coded label
 *      (`statusColorClass`), NOT the trustee's Review-button / "Approved &
 *      minted" pill — the LP app is read-only for submissions.
 *   3. Table styling reuses the dashboard Loan Book table's existing visual
 *      tokens (`headerCellClasses`/`bodyCellClasses` from `LoanBookTable.tsx`)
 *      rather than the trustee's grid layout — there is no LP-specific Figma
 *      frame for this column set.
 *
 * `table-fixed` + `<colgroup>` + `overflow-x-auto` mirror `LoanBookTable`'s
 * geometry (FRONTEND.md wide-content rule).
 *
 * Layout (human review follow-up): every column has a fixed width and
 * truncates — the truncation-capable cell pattern (`firstBodyCellClasses`'
 * `overflow-hidden max-w-0` on the `<td>` + `truncate` on the inner span) is
 * applied to ALL columns, not just the first, so long values (e.g. a long
 * commodity or a "South Korea → Mongolia" corridor) clip with an ellipsis
 * instead of spilling into the neighbouring column. Columns are separated by
 * 12px via `pr-3` on every cell except the last.
 */
import type { OriginationTableRow } from "./originationRow";
import {
  headerCellClasses,
  firstBodyCellClasses,
  firstBodyCellInnerClasses,
} from "./LoanBookTable";

// Status column text colour — semantic content tokens, mirroring the
// WithdrawalQueueTable status-colour pattern (same as the retired
// `LoanBookTable.statusColorClass`, issue #755):
//   - Approved  → positive (green)
//   - Rejected  → negative (red)
//   - InReview  → pending  (amber)
//   - anything else (including "—") → muted ink (neutral fallback)
function statusColorClass(status: string): string {
  switch (status) {
    case "Approved":
      return "text-[color:var(--color-pipeline-positive)]";
    case "Rejected":
      return "text-[color:var(--color-pipeline-negative)]";
    case "InReview":
      return "text-[color:var(--color-pipeline-pending)]";
    default:
      return "text-[color:var(--color-pipeline-ink-muted)]";
  }
}

export interface OriginationTableProps {
  rows: OriginationTableRow[];
}

// Column geometry (Figma 4116-9155 field set). `width: undefined` = the
// Originator column, left flexible so it absorbs the remaining table width;
// the rest are fixed so their content truncates rather than reflowing. Widths
// account for the 12px inter-column gap (`pr-3`) applied to every cell but the
// last.
const COLUMNS: {
  key: keyof Omit<OriginationTableRow, "id">;
  label: string;
  width?: string;
}[] = [
  { key: "originator", label: "Originator", width: undefined },
  { key: "commodity", label: "Commodity", width: "176px" },
  { key: "facility", label: "Facility", width: "120px" },
  { key: "corridor", label: "Corridor", width: "148px" },
  { key: "rate", label: "Rate", width: "84px" },
  { key: "maturity", label: "Maturity", width: "120px" },
  { key: "submitted", label: "Submitted", width: "96px" },
  { key: "status", label: "Status", width: "104px" },
];

export function OriginationTable({ rows }: OriginationTableProps) {
  return (
    <div data-testid="origination-table">
      <div
        className="w-full overflow-x-auto"
        data-testid="origination-table-desktop"
      >
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            {COLUMNS.map((col) => (
              <col
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((col, i) => (
                <th
                  key={col.key}
                  className={[
                    headerCellClasses,
                    i < COLUMNS.length - 1 ? "pr-3" : "",
                  ].join(" ")}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {COLUMNS.map((col, i) => (
                  <td
                    key={col.key}
                    // Truncation-capable cell (overflow-hidden + max-w-0) for
                    // EVERY column, so long values clip with an ellipsis
                    // instead of overflowing into the next column. pr-3 = 12px
                    // gap between columns (omitted on the last).
                    className={[
                      firstBodyCellClasses,
                      i < COLUMNS.length - 1 ? "pr-3" : "",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        firstBodyCellInnerClasses,
                        col.key === "status"
                          ? statusColorClass(row.status)
                          : "",
                      ].join(" ")}
                    >
                      {row[col.key]}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default OriginationTable;

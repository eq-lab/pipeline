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
 */
import type { OriginationTableRow } from "./originationRow";
import {
  headerCellClasses,
  bodyCellClasses,
  bodyCellInnerClasses,
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

export function OriginationTable({ rows }: OriginationTableProps) {
  return (
    <div data-testid="origination-table">
      <div
        className="w-full overflow-x-auto"
        data-testid="origination-table-desktop"
      >
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            {/* Originator — flexible, fills remaining width */}
            <col />
            <col style={{ width: "160px" }} />
            <col style={{ width: "128px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "96px" }} />
            <col style={{ width: "112px" }} />
            <col style={{ width: "96px" }} />
            <col style={{ width: "112px" }} />
          </colgroup>
          <thead>
            <tr>
              <th className={[headerCellClasses, "pr-3"].join(" ")}>
                Originator
              </th>
              <th className={headerCellClasses}>Commodity</th>
              <th className={headerCellClasses}>Facility</th>
              <th className={headerCellClasses}>Corridor</th>
              <th className={headerCellClasses}>Rate</th>
              <th className={headerCellClasses}>Maturity</th>
              <th className={headerCellClasses}>Submitted</th>
              <th className={headerCellClasses}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={[firstBodyCellClasses, "pr-3"].join(" ")}>
                  <span className={firstBodyCellInnerClasses}>
                    {row.originator}
                  </span>
                </td>
                <td className={bodyCellClasses}>
                  <span className={bodyCellInnerClasses}>{row.commodity}</span>
                </td>
                <td className={bodyCellClasses}>
                  <span className={bodyCellInnerClasses}>{row.facility}</span>
                </td>
                <td className={bodyCellClasses}>
                  <span className={bodyCellInnerClasses}>{row.corridor}</span>
                </td>
                <td className={bodyCellClasses}>
                  <span className={bodyCellInnerClasses}>{row.rate}</span>
                </td>
                <td className={bodyCellClasses}>
                  <span className={bodyCellInnerClasses}>{row.maturity}</span>
                </td>
                <td className={bodyCellClasses}>
                  <span className={bodyCellInnerClasses}>{row.submitted}</span>
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
    </div>
  );
}

export default OriginationTable;

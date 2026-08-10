/**
 * OriginationTable — the In-Origination tab's submissions table for the Loan
 * Book panel (issue #814, Figma node `4116-9155`).
 *
 * spec: docs/frontend/dashboard-components.md#originationtable
 * (columns, resolved Open Questions, truncation layout).
 */
import type { OriginationTableRow } from "./originationRow";
import {
  headerCellClasses,
  firstBodyCellClasses,
  firstBodyCellInnerClasses,
} from "./LoanBookTable";

// spec: docs/frontend/dashboard-components.md#originationtable (status color mapping)
function statusColorClass(status: string): string {
  switch (status) {
    case "Approved":
      return "text-[color:var(--color-pipeline-positive)]";
    case "Rejected":
      return "text-[color:var(--color-pipeline-negative)]";
    case "InReview":
    case "ChangesRequested":
      return "text-[color:var(--color-pipeline-pending)]";
    default:
      return "text-[color:var(--color-pipeline-ink-muted)]";
  }
}

export interface OriginationTableProps {
  rows: OriginationTableRow[];
}

// spec: docs/frontend/dashboard-components.md#originationtable (column widths)
const COLUMNS: {
  key: keyof Omit<OriginationTableRow, "id" | "statusLabel">;
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
                      {col.key === "status" ? row.statusLabel : row[col.key]}
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

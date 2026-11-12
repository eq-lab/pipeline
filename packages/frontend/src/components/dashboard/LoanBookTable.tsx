// spec: docs/frontend/dashboard-components.md#loanbooktable
// ── Row type ──────────────────────────────────────────────────────────────────

export interface LoanBookRow {
  commodity: string;
  principal: string;
  ltv: string;
  duration: string;
  rate: string;
  protection: string;
}

export interface LoanBookHeaderAggregates {
  principal?: string;
  ltv?: string;
}

export interface LoanBookTableProps {
  rows: LoanBookRow[];
  headerAggregates?: LoanBookHeaderAggregates;
}

// ── Token class constants ─────────────────────────────────────────────────────
export const headerCellClasses = [
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

export const bodyCellClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
  "py-3",
  "whitespace-nowrap",
  "border-t border-[color:var(--color-pipeline-line-subtle)]",
].join(" ");

export const bodyCellInnerClasses = "block";

export const firstBodyCellClasses = [
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

export const firstBodyCellInnerClasses = "block truncate";

// ── Table (all viewports) ─────────────────────────────────────────────────────

function LoanTable({ rows, headerAggregates }: LoanBookTableProps) {
  const agg = headerAggregates ?? {};
  return (
    <div
      className="w-full overflow-x-auto"
      data-testid="loan-book-table-desktop"
    >
      <table className="w-full min-w-[1024px] table-fixed border-collapse">
        <colgroup>
          <col />
          <col style={{ width: "112px" }} />
          <col style={{ width: "160px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "128px" }} />
        </colgroup>
        <thead>
          <tr>
            <th className={[headerCellClasses, "pr-3"].join(" ")}>Commodity</th>
            <th className={headerCellClasses}>
              Principal
              {agg.principal != null && (
                <span
                  data-testid="loan-book-header-principal-aggregate"
                  aria-hidden="false"
                >
                  {" · "}
                  {agg.principal}
                </span>
              )}
            </th>
            <th className={headerCellClasses}>
              LTV
              {agg.ltv != null && (
                <span
                  data-testid="loan-book-header-ltv-aggregate"
                  aria-hidden="false"
                >
                  {" · "}
                  {agg.ltv}
                </span>
              )}
            </th>
            <th className={headerCellClasses}>Duration</th>
            <th className={headerCellClasses}>Rate</th>
            <th className={headerCellClasses}>Protection</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className={[firstBodyCellClasses, "pr-3"].join(" ")}>
                <span className={firstBodyCellInnerClasses}>
                  {row.commodity}
                </span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.principal}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.ltv}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.duration}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.rate}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.protection}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── LoanBookTable ─────────────────────────────────────────────────────────────

export function LoanBookTable({ rows, headerAggregates }: LoanBookTableProps) {
  return (
    <div data-testid="loan-book-table">
      <LoanTable rows={rows} headerAggregates={headerAggregates} />
    </div>
  );
}

export default LoanBookTable;

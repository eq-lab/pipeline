/**
 * LoanBookTable — active-loan table for the Loan Book panel.
 *
 * spec: docs/frontend/dashboard-components.md#loanbooktable
 * (columns, responsive/mobile behavior, Figma column widths/spacing/typography).
 */
// ── Row type ──────────────────────────────────────────────────────────────────

/** One pre-formatted loan row, as prepared by `useDeploymentMonitorPanel`. */
export interface LoanBookRow {
  /** Combined "Borrower / Commodity" label. */
  borrowerCommodity: string;
  principal: string;
  collateral: string;
  ltv: string;
  /** Duration in compact form, e.g. `"120d"`. */
  duration: string;
  rate: string;
  protection: string;
}

/**
 * Pre-formatted aggregate strings for the table column headers.
 * spec: docs/frontend/dashboard-components.md#loanbooktable (headerAggregates fields).
 */
export interface LoanBookHeaderAggregates {
  principal?: string;
  collateral?: string;
  ltv?: string;
}

export interface LoanBookTableProps {
  rows: LoanBookRow[];
  /**
   * Optional pre-formatted aggregate strings for the column headers.
   * spec: docs/frontend/dashboard-components.md#loanbooktable (header aggregate rendering).
   */
  headerAggregates?: LoanBookHeaderAggregates;
}

// ── Token class constants ─────────────────────────────────────────────────────
// spec: docs/frontend/dashboard-components.md#loanbooktable (cell/header spacing & typography Figma tokens)
// Exported for reuse by `OriginationTable.tsx` (issue #814 decision — see spec).
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

// Body cell geometry — spec: docs/frontend/dashboard-components.md#loanbooktable (row height/padding).
// `border-t` is on <td> (not <tr>) because <tr> border rendering is unreliable
// in some browsers; border-collapse needs it on the cell to merge correctly.
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
      {/*
       * table-layout: fixed + <col> widths — spec: docs/frontend/dashboard-components.md#loanbooktable
       * (column widths). border-collapse: dividers are on <td>/<th> (not <tr>)
       * because <tr> border rendering is unreliable in some browsers.
       */}
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {/* Borrower/Commodity — flexible, fills remaining width */}
          <col />
          <col style={{ width: "112px" }} />
          <col style={{ width: "112px" }} />
          <col style={{ width: "112px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "128px" }} />
        </colgroup>
        <thead>
          {/* Header <tr> has no border class — border-b lives on each <th> (headerCellClasses). */}
          <tr>
            <th className={[headerCellClasses, "pr-3"].join(" ")}>
              Borrower / Commodity
            </th>
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
              Collateral
              {agg.collateral != null && (
                <span
                  data-testid="loan-book-header-collateral-aggregate"
                  aria-hidden="false"
                >
                  {" · "}
                  {agg.collateral}
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
            // Row borders are on <td> cells, not <tr> (see above). Figma's
            // row border-radius is unsupported on <tr> — logged as TD-26 in
            // tech-debt-tracker.md.
            <tr key={i}>
              <td className={[firstBodyCellClasses, "pr-3"].join(" ")}>
                <span className={firstBodyCellInnerClasses}>
                  {row.borrowerCommodity}
                </span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.principal}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.collateral}</span>
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

/**
 * Renders the active-loan table at all viewport widths.
 * spec: docs/frontend/dashboard-components.md#loanbooktable (mobile/desktop behavior).
 */
export function LoanBookTable({ rows, headerAggregates }: LoanBookTableProps) {
  return (
    <div data-testid="loan-book-table">
      <LoanTable rows={rows} headerAggregates={headerAggregates} />
    </div>
  );
}

export default LoanBookTable;

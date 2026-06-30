/**
 * LoanBookTable — responsive active-loan table for the Loan Book panel.
 *
 * Desktop (`md+`): a semantic `<table>` with 7 columns matching the Figma
 *   header row: Borrower / Commodity, Principal, Collateral, LTV, Duration,
 *   Rate, Protection. Wrapped in `overflow-x: auto` so it never forces
 *   horizontal page scroll (FRONTEND.md wide-content rule).
 *
 * Mobile (below `md`): each loan rendered as a stacked card of label/value
 *   pairs with a divider between loans.
 *
 * Figma references:
 *   Desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431
 *   Mobile:  https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72323
 *
 * Token discipline: no raw hex/font values.
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

export interface LoanBookTableProps {
  rows: LoanBookRow[];
}

// ── Token class constants ─────────────────────────────────────────────────────

const headerCellClasses = [
  "text-left",
  "font-[family-name:var(--font-text)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body-s,14px)]",
  "leading-[var(--text-pipeline-body-s--line-height,20px)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "pb-3",
  "whitespace-nowrap",
].join(" ");

const bodyCellClasses = [
  "font-[family-name:var(--font-text)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body,16px)]",
  "leading-[var(--text-pipeline-body--line-height,24px)]",
  "text-[color:var(--color-pipeline-ink)]",
  "py-4",
  "whitespace-nowrap",
].join(" ");

// First column is wider (borrower/commodity)
const firstBodyCellClasses = [
  bodyCellClasses,
  "pr-6",
  "font-medium",
].join(" ");

// Mobile card label
const mobileLabelClasses = [
  "font-[family-name:var(--font-text)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body-s,14px)]",
  "leading-[var(--text-pipeline-body-s--line-height,20px)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

// Mobile card value
const mobileValueClasses = [
  "font-[family-name:var(--font-text)]",
  "font-medium",
  "text-[length:var(--text-pipeline-body,16px)]",
  "leading-[var(--text-pipeline-body--line-height,24px)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// ── Desktop table ─────────────────────────────────────────────────────────────

function DesktopTable({ rows }: LoanBookTableProps) {
  return (
    <div
      className="hidden md:block overflow-x-auto w-full"
      data-testid="loan-book-table-desktop"
    >
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--color-pipeline-ink-divider)]">
            <th className={[headerCellClasses, "pr-6"].join(" ")}>
              Borrower / Commodity
            </th>
            <th className={headerCellClasses}>Principal</th>
            <th className={headerCellClasses}>Collateral</th>
            <th className={headerCellClasses}>LTV</th>
            <th className={headerCellClasses}>Duration</th>
            <th className={headerCellClasses}>Rate</th>
            <th className={headerCellClasses}>Protection</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[color:var(--color-pipeline-ink-divider)] last:border-b-0"
            >
              <td className={firstBodyCellClasses}>{row.borrowerCommodity}</td>
              <td className={bodyCellClasses}>{row.principal}</td>
              <td className={bodyCellClasses}>{row.collateral}</td>
              <td className={bodyCellClasses}>{row.ltv}</td>
              <td className={bodyCellClasses}>{row.duration}</td>
              <td className={bodyCellClasses}>{row.rate}</td>
              <td className={bodyCellClasses}>{row.protection}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Mobile stacked cards ──────────────────────────────────────────────────────

function MobileCards({ rows }: LoanBookTableProps) {
  return (
    <div
      className="block md:hidden flex flex-col divide-y divide-[color:var(--color-pipeline-ink-divider)]"
      data-testid="loan-book-table-mobile"
    >
      {rows.map((row, i) => (
        <div key={i} className="py-4 flex flex-col gap-2">
          {/* Primary row: borrower/commodity in full */}
          <div className={mobileValueClasses}>{row.borrowerCommodity}</div>
          {/* Grid of label/value pairs */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <MobileField label="Principal" value={row.principal} />
            <MobileField label="Collateral" value={row.collateral} />
            <MobileField label="LTV" value={row.ltv} />
            <MobileField label="Duration" value={row.duration} />
            <MobileField label="Rate" value={row.rate} />
            <MobileField label="Protection" value={row.protection} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MobileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={mobileLabelClasses}>{label}</span>
      <span className={mobileValueClasses}>{value}</span>
    </div>
  );
}

// ── LoanBookTable (both breakpoints) ─────────────────────────────────────────

/**
 * Renders the active-loan table. Switches between desktop `<table>` (md+) and
 * stacked mobile cards (below md) automatically via Tailwind breakpoints.
 */
export function LoanBookTable({ rows }: LoanBookTableProps) {
  return (
    <div data-testid="loan-book-table">
      <DesktopTable rows={rows} />
      <MobileCards rows={rows} />
    </div>
  );
}

export default LoanBookTable;

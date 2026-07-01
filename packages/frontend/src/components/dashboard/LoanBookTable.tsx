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

/**
 * Pre-formatted aggregate strings for the table column headers.
 *
 * Populated by `useDeploymentMonitorPanel` from `summary` fields.
 * Only Principal and Collateral carry aggregates (LTV subtitle intentionally
 * omitted until a backend `portfolio_ltv` field exists — resolved in #729).
 *
 * `undefined` means "render the plain label with no aggregate" (not "—").
 * This avoids rendering `Collateral · —` when `total_collateral` is null.
 */
export interface LoanBookHeaderAggregates {
  /** Formatted `total_deployed`, e.g. `"$31.6M"`. Always defined when ready. */
  principal?: string;
  /**
   * Formatted `total_collateral`, e.g. `"$37.6M"`. `undefined` while
   * TODO #706 (commodity price feed) is not yet merged.
   */
  collateral?: string;
}

export interface LoanBookTableProps {
  rows: LoanBookRow[];
  /**
   * Optional pre-formatted aggregate strings for the desktop column headers.
   * When present, the Principal and Collateral headers render as
   * `"Principal · $31.6M"` (label + middot + aggregate in one caption run).
   *
   * Mobile stacked-card layout (`MobileCards` / `MobileField`) has no header
   * row — aggregates do NOT apply there (Figma node 3283-72323 shows no header).
   * Do NOT add aggregates to the mobile per-loan field labels.
   */
  headerAggregates?: LoanBookHeaderAggregates;
}

// ── Token class constants ─────────────────────────────────────────────────────

// Column-header typography: 12px/16px caption token — matches Figma node
// 3283-14431 exactly (resolved open question #2 in issue #729). The label and
// aggregate are one continuous caption run joined by a middot ` · `.
const headerCellClasses = [
  "text-left",
  "font-[family-name:var(--font-text)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption,12px)]",
  "leading-[var(--text-pipeline-caption--line-height,16px)]",
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

function DesktopTable({ rows, headerAggregates }: LoanBookTableProps) {
  const agg = headerAggregates ?? {};
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
 *
 * Note: `headerAggregates` only applies to the desktop header row. The mobile
 * stacked-card layout (`MobileCards`) has no header row — aggregates are NOT
 * passed through there (Figma node 3283-72323 shows no header row on mobile).
 */
export function LoanBookTable({ rows, headerAggregates }: LoanBookTableProps) {
  return (
    <div data-testid="loan-book-table">
      <DesktopTable rows={rows} headerAggregates={headerAggregates} />
      <MobileCards rows={rows} />
    </div>
  );
}

export default LoanBookTable;

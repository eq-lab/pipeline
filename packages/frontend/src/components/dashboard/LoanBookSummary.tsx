/**
 * LoanBookSummary — five summary header cards for the Loan Book panel.
 *
 * Presentational: all values are pre-formatted strings.
 *
 * Mobile (below `md`): horizontally-scrollable flex row — each card is fixed
 *   `w-[200px] shrink-0` (Figma `3283:72325` "Second card pair": cards are
 *   200px, gap 16px, container h=144). The outer `overflow-x-auto` wrapper lets
 *   the user scroll to reach all 5 cards without wrapping or page overflow.
 *
 * Desktop (`md+`): flex row that stretches cards to fill the full width
 *   equally (flex-1 on each card), matching the 5-column desktop layout.
 *
 * Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline
 *   Desktop: node 3283:14434 — "card-horizontal" (single card)
 *            node 3283:14433 — "Second card pair" (full row of 5 cards)
 *   Mobile:  node 3283:72325 — "Second card pair" XS (200px cards, 16px gap, scrollable)
 *
 * Token discipline: no raw hex/font values — all from CSS custom props.
 */
import React from "react";

export interface LoanBookSummaryProps {
  /** Total Deployed, formatted (e.g. `"$31.6M"` or `"—"`). */
  totalDeployed: string;
  /** Collateral, formatted (e.g. `"$46.1M"` or `"—"`). */
  totalCollateral: string;
  /** Senior Debt Coverage, formatted (e.g. `"1.5x"` or `"—"`). */
  seniorDebtCoverage: string;
  /** Yield, formatted (e.g. `"11.2%"` or `"—"`). */
  avgYield: string;
  /** Average Duration, formatted (e.g. `"68 days"` or `"—"`). */
  avgDuration: string;
}

// ── Shared card token classes ─────────────────────────────────────────────────

// Card surface: white (fill-test/on-primary) background; border-test/secondary
// with asymmetric widths — 1px top+left, 3px bottom+right — matching Figma
// "border-b-3 border-r-3" treatment; radius/radius-xxl = 4px (--radius-pipeline-card);
// 16px padding on all sides (size-16). Fixed height 144px confirmed from Figma
// frame 3283:14434 (height=144): label sits at y=16, value at y=100.
//
// Mobile: w-[200px] shrink-0 — fixed 200px, does not shrink (Figma card width).
// Desktop: flex-1 — stretches to fill equal column width in the 5-card row.
const cardClasses = [
  "flex flex-col justify-between",
  "bg-[color:var(--color-pipeline-surface)]",
  "border-t border-l border-b-[3px] border-r-[3px]",
  "border-[color:var(--color-pipeline-line)]",
  "rounded-[var(--radius-pipeline-card,4px)]",
  "p-4",
  // 144px matches Figma frame 3283:14434 height exactly.
  "h-[144px]",
  // Mobile: fixed 200px per Figma card width, no shrink (card row scrolls).
  // Desktop: flex-1 expands to fill the available width equally.
  "w-[200px] shrink-0 md:w-auto md:flex-1",
].join(" ");

// Card label: Heading S — Graphik LC (body font), 16px/20px, weight regular (400).
// Figma: font/text-font-family = "Graphik LC", font/font-size/heading-s = 16px,
// font/line-height/heading-s = 20px, font/title-font-weight = "Regular" (400).
// The Heading S style lists weight 700 in its source-font name but the CSS
// variable font/title-font-weight resolves to "normal"/400 — use font-normal.
const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body,16px)]",
  "leading-[20px]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// Card value: Heading 20 — Besley (display font), 20px/28px, weight 400,
// color content-test/primary. Matches Figma font/title-font-family = "Besley".
const valueClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[20px]",
  "leading-[28px]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// ── SummaryCard ───────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
}: {
  label: React.ReactNode;
  value: string;
}) {
  return (
    <div className={cardClasses}>
      <div className={labelClasses}>{label}</div>
      <div className={valueClasses}>{value}</div>
    </div>
  );
}

// ── LoanBookSummary ───────────────────────────────────────────────────────────

/**
 * Five summary header cards.
 *
 * Mobile (below `md`): outer `overflow-x-auto` wrapper; inner `flex gap-4`
 *   row with fixed-200px cards that do not shrink — user scrolls horizontally
 *   to reach all 5. Matches Figma XS node `3283:72325`.
 * Desktop (`md+`): cards stretch to fill width equally (`flex-1`), all 5
 *   visible in one row.
 */
export function LoanBookSummary({
  totalDeployed,
  totalCollateral,
  seniorDebtCoverage,
  avgYield,
  avgDuration,
}: LoanBookSummaryProps) {
  return (
    <div className="w-full overflow-x-auto">
      <div
        className="flex items-stretch gap-4"
        data-testid="loan-book-summary-cards"
      >
        <SummaryCard
          label={
            <>
              Total
              <br />
              Deployed
            </>
          }
          value={totalDeployed}
        />
        <SummaryCard label="Collateral" value={totalCollateral} />
        <SummaryCard
          label={
            <>
              Senior Debt
              <br />
              Coverage
            </>
          }
          value={seniorDebtCoverage}
        />
        <SummaryCard label="Yield" value={avgYield} />
        <SummaryCard
          label={
            <>
              Average
              <br />
              Duration
            </>
          }
          value={avgDuration}
        />
      </div>
    </div>
  );
}

export default LoanBookSummary;

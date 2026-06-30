/**
 * LoanBookSummary — five summary header cards for the Loan Book panel.
 *
 * Presentational: all values are pre-formatted strings. Renders a horizontal
 * scrollable row on mobile and a 5-column grid on desktop.
 *
 * Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline
 *   Desktop: node 3283:14431 — "Second card pair" frame
 *   Mobile:  node 3283:72323 — "Second card pair" frame (200px wide cards,
 *            horizontally scrollable, 16px gap)
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

// Card surface: white background, secondary border with 3px right+bottom
// shadows and 1px top+left (matching Figma "border-b-3 border-r-3" treatment),
// 24px radius (radius-xxl).
const cardClasses = [
  "flex flex-col justify-between",
  "bg-[color:var(--color-pipeline-paper)]",
  "border border-[color:var(--color-pipeline-ink-divider)]",
  "rounded-[var(--radius-pipeline-xl,16px)]",
  "p-4",
  // Fixed height to match Figma card (144px), full width inside scroll container
  "h-[144px]",
  // Min width to keep cards a consistent width on mobile scroll
  "min-w-[180px]",
  // Desktop: let the grid size them naturally
  "md:min-w-0",
].join(" ");

// Card label: small, body-size, muted ink
const labelClasses = [
  "font-[family-name:var(--font-text)]",
  "font-semibold",
  "text-[length:var(--text-pipeline-body-s,14px)]",
  "leading-[var(--text-pipeline-body-s--line-height,20px)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// Card value: heading-20 (20px, display font)
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
 * Desktop (`md+`): a 5-column grid with equal-width cells and 16px gaps.
 * Mobile (below `md`): a horizontally scrollable strip of fixed-width cards
 * (180px each) with 16px gaps — matches the Figma mobile frame `3283:72323`.
 */
export function LoanBookSummary({
  totalDeployed,
  totalCollateral,
  seniorDebtCoverage,
  avgYield,
  avgDuration,
}: LoanBookSummaryProps) {
  return (
    // Outer wrapper handles overflow clipping on mobile.
    <div className="w-full overflow-x-auto">
      <div
        className={[
          "flex gap-4",
          "md:grid md:grid-cols-5 md:gap-4",
        ].join(" ")}
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

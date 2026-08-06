/**
 * LoanBookSummary — five summary header cards for the Loan Book panel.
 *
 * spec: docs/frontend/dashboard-components.md#loanbooksummary
 * (responsive layout, Figma bindings, card typography).
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
// spec: docs/frontend/dashboard-components.md#loanbooksummary (card surface/label/value Figma tokens)
const cardClasses = [
  "flex flex-col justify-between",
  "bg-[color:var(--color-pipeline-surface)]",
  "border-t border-l border-b-[3px] border-r-[3px]",
  "border-[color:var(--color-pipeline-line)]",
  "rounded-[var(--radius-pipeline-card,4px)]",
  "p-4",
  "h-[144px]",
  "w-[200px] shrink-0 md:w-auto md:flex-1",
].join(" ");

const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body,16px)]",
  "leading-[20px]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

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
 * spec: docs/frontend/dashboard-components.md#loanbooksummary (responsive layout).
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

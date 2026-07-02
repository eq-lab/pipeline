/**
 * BalanceSheetPanel — Protocol Dashboard Panel A.
 *
 * Statement of Financial Position (Figma 3283:14275 desktop / 3283:72288 mobile).
 * Data is blended from REST `GET /v1/financial-position` + Soroban on-chain reads
 * (`useStellarPlusdTotalSupply`, `useStellarUsdcReserveBalance`).
 *
 * Layout: two-column (Assets | Liabilities) on desktop, stacked on mobile.
 * A 1px vertical divider separates the columns on desktop only.
 * Each column has a card body with sub-sections.
 *
 * Token discipline: no raw hex/font/size literals (layout pixel hints only).
 * Stable `data-testid` attributes on every row.
 */
import React from "react";
import { PanelContainer } from "./PanelContainer";
import { useBalanceSheetPanel } from "./useBalanceSheetPanel";
import type { BalanceSheetRow } from "./useBalanceSheetPanel";

// ── Balance sheet row ─────────────────────────────────────────────────────────

// Row: top border + padding + label (muted) + optional caption + right-aligned value (ink).
const rowClasses = [
  "flex items-start justify-between pt-4",
  "border-t border-[color:var(--color-pipeline-line)]",
].join(" ");

const labelClasses = [
  "flex flex-col gap-0.5",
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body,16px)]",
  "leading-[20px]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

const captionClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

const valueClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body,16px)]",
  "leading-[20px]",
  "text-[color:var(--color-pipeline-ink)]",
  "text-right",
].join(" ");

function BalanceSheetRowComponent({ row }: { row: BalanceSheetRow }) {
  return (
    <div className={rowClasses} data-testid={row.testId}>
      <div className={labelClasses}>
        <span>{row.label}</span>
        {row.caption && <span className={captionClasses}>{row.caption}</span>}
      </div>
      <span className={valueClasses}>{row.value}</span>
    </div>
  );
}

// ── Sub-section ───────────────────────────────────────────────────────────────

// Sub-section title: 20px/28px display serif, regular weight.
const subSectionTitleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[20px]",
  "leading-[28px]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

interface SubSectionProps {
  title: string;
  rows: BalanceSheetRow[];
}

function SubSection({ title, rows }: SubSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className={subSectionTitleClasses}>{title}</div>
      {rows.map((row) => (
        <BalanceSheetRowComponent key={row.testId} row={row} />
      ))}
    </div>
  );
}

// ── Column card ───────────────────────────────────────────────────────────────

// Column heading row: display serif heading-m, muted total baseline-aligned.
const columnHeadingRowClasses = "flex items-baseline justify-between";

const columnTitleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m-mobile)]",
  "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-m)]",
  "md:leading-[var(--text-pipeline-heading-m--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

const columnTotalClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m-mobile)]",
  "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-m)]",
  "md:leading-[var(--text-pipeline-heading-m--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

// Card body: white surface, asymmetric depth border, 4px radius, 16px padding.
const cardBodyClasses = [
  "bg-[color:var(--color-pipeline-surface)]",
  "border-t border-l border-b-[3px] border-r-[3px]",
  "border-[color:var(--color-pipeline-line)]",
  "rounded-[var(--radius-pipeline-card,4px)]",
  "p-4",
  "flex flex-col gap-8",
].join(" ");

interface ColumnProps {
  title: string;
  total: string;
  children: React.ReactNode;
  testId: string;
}

function Column({ title, total, children, testId }: ColumnProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-1" data-testid={testId}>
      <div className={columnHeadingRowClasses}>
        <h3 className={columnTitleClasses}>{title}</h3>
        <span className={columnTotalClasses} data-testid={`${testId}-total`}>
          {total}
        </span>
      </div>
      <div className={cardBodyClasses}>{children}</div>
    </div>
  );
}

// ── Footnote ──────────────────────────────────────────────────────────────────

const footnoteClasses = [
  "text-center",
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "mt-2",
].join(" ");

// ── Panel ─────────────────────────────────────────────────────────────────────

export function BalanceSheetPanel() {
  const { state, assets, liabilities, errorMessage, refetch, showTotalsDisclaimer } =
    useBalanceSheetPanel();

  return (
    <PanelContainer
      title="Balance Sheet"
      state={state}
      onRetry={refetch}
      errorMessage={errorMessage}
      data-testid="dashboard-panel-balance-sheet"
      data-node-id="3283:14275"
    >
      {/*
       * Two-column layout (desktop) / stacked (mobile).
       * Desktop: flex-row with a 1px vertical divider between columns.
       * Mobile: flex-col, Assets over Liabilities.
       */}
      <div className="flex flex-col gap-8 md:flex-row">
        {/* Assets column */}
        <Column
          title="Assets"
          total={assets.total}
          testId="bs-col-assets"
        >
          <SubSection title="Liquid" rows={assets.liquid} />
          <SubSection title="Deployed" rows={assets.deployed} />
        </Column>

        {/* Desktop-only vertical divider */}
        <div
          className="hidden md:block w-px bg-[color:var(--color-pipeline-line)] self-stretch"
          aria-hidden
        />

        {/* Liabilities column */}
        <Column
          title="Liabilities"
          total={liabilities.total}
          testId="bs-col-liabilities"
        >
          <SubSection title="Senior Claims" rows={liabilities.seniorClaims} />
          <SubSection
            title="Subordinated Capital"
            rows={liabilities.subordinatedCapital}
          />
        </Column>
      </div>

      {/* Muted footnote when section totals are incomplete (Open Question 1) */}
      {showTotalsDisclaimer && (
        <p className={footnoteClasses} data-testid="bs-totals-disclaimer">
          Excludes assets pending a data source
        </p>
      )}
    </PanelContainer>
  );
}

export default BalanceSheetPanel;

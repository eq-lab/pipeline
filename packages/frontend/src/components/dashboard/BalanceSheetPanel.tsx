/**
 * BalanceSheetPanel — Protocol Dashboard Panel A.
 *
 * spec: docs/frontend/dashboard-components.md#balancesheetpanel
 * (architecture, layout, Figma token mapping, token discipline).
 */
import React from "react";
import { PanelLoading } from "./PanelLoading";
import { PanelError } from "./PanelError";
import { useBalanceSheetPanel } from "./useBalanceSheetPanel";
import type { BalanceSheetRow } from "./useBalanceSheetPanel";

// ── Balance sheet row ─────────────────────────────────────────────────────────
// spec: docs/frontend/dashboard-components.md#balancesheetpanel (row/label/caption/value Figma tokens)
const rowClasses = [
  "flex items-start justify-between gap-3 pt-4 pr-4",
  "border-t border-[color:var(--color-pipeline-line)]",
].join(" ");

const labelClasses = [
  "flex flex-col gap-0.5",
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
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
  "shrink-0",
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
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
// spec: docs/frontend/dashboard-components.md#balancesheetpanel (sub-section header Figma tokens)
const subSectionTitleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-s)]",
  "leading-[var(--text-pipeline-heading-s--line-height)]",
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
// spec: docs/frontend/dashboard-components.md#balancesheetpanel (column heading/title/total/card-body Figma tokens)
const columnHeadingRowClasses = "flex items-baseline justify-between";

const columnTitleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

const columnTotalClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

const cardBodyClasses = [
  "flex-1",
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
    <div className="flex flex-1 flex-col gap-4" data-testid={testId}>
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

// ── Panel title ───────────────────────────────────────────────────────────────
// spec: docs/frontend/dashboard-components.md#balancesheetpanel (panel title Figma tokens)
const panelTitleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-l)]",
  "md:leading-[var(--text-pipeline-heading-l--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// ── Panel ─────────────────────────────────────────────────────────────────────

export function BalanceSheetPanel() {
  const { state, assets, liabilities, errorMessage, refetch } =
    useBalanceSheetPanel();

  return (
    // spec: docs/frontend/dashboard-components.md#balancesheetpanel (borderless section wrapper)
    <div
      className="flex flex-col gap-8"
      data-testid="dashboard-panel-balance-sheet"
      data-node-id="3283:14275"
    >
      {/* Section title — "Statement of Financial Position" */}
      <h2 className={panelTitleClasses}>Statement of Financial Position</h2>

      {/* Loading state */}
      {state === "loading" && <PanelLoading data-testid="panel-loading" />}

      {/* Error state */}
      {state === "error" && (
        <PanelError
          data-testid="panel-error"
          onRetry={refetch}
          message={errorMessage}
        />
      )}

      {/* Ready: two-column layout (desktop md+) / stacked (mobile) */}
      {state === "ready" && (
        // spec: docs/frontend/dashboard-components.md#balancesheetpanel (ready-state two-column layout)
        <div className="flex flex-col gap-8 md:flex-row md:items-stretch">
          {/* Assets column */}
          <Column title="Assets" total={assets.total} testId="bs-col-assets">
            <SubSection title="Liquid" rows={assets.liquid} />
            <SubSection title="Deployed" rows={assets.deployed} />
          </Column>

          {/* Vertical divider (desktop only) */}
          <div
            className="hidden w-px self-stretch bg-[color:var(--color-pipeline-line)] md:block"
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
      )}
    </div>
  );
}

export default BalanceSheetPanel;

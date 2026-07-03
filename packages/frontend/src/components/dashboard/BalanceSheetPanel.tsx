/**
 * BalanceSheetPanel — Protocol Dashboard Panel A.
 *
 * Statement of Financial Position (Figma 3283:14275 desktop / 3283:72288 mobile).
 * Data is blended from REST `GET /v1/financial-position` + Soroban on-chain reads
 * (`useStellarPlusdTotalSupply`, `useStellarUsdcReserveBalance`).
 *
 * Layout: two-column (Assets | Liabilities) on desktop (md+), stacked on mobile.
 * A 1px vertical divider separates the columns on desktop only (Figma 3283:14298).
 * NO outer border/card wrapping this section — chrome lives on the inner bordered
 * cards only (Figma 3283:14275 section frame is borderless).
 *
 * Figma token mapping (pixel-authoritative):
 *   Title                : heading-l 48px/56px  → --text-pipeline-heading-l
 *   Section headers      : heading-m 28px/36px  → --text-pipeline-heading-m
 *   Sub-section headers  : heading-s 20px/28px  → --text-pipeline-heading-s
 *   Row labels + values  : body      16px/22px  → --text-pipeline-body
 *   Caption "1:1 reem."  : caption   12px/16px  → --text-pipeline-caption
 *   Border color         : border-test/secondary → --color-pipeline-line
 *   Card padding         : size-16   16px       → p-4
 *   Card gap             : size-32   32px       → gap-8 (between sub-sections)
 *   Container gap        : size-32   32px       → gap-8 (between columns)
 *   Row pad-top/right    : gap-s     16px       → pt-4 pr-4
 *   Row content-amount   : size-12   12px       → gap-3
 *
 * Token discipline: no raw hex/font/size literals (pixel comments are doc only).
 * Stable `data-testid` attributes on every row.
 */
import React from "react";
import { PanelLoading } from "./PanelLoading";
import { PanelError } from "./PanelError";
import { useBalanceSheetPanel } from "./useBalanceSheetPanel";
import type { BalanceSheetRow } from "./useBalanceSheetPanel";

// ── Balance sheet row ─────────────────────────────────────────────────────────

// Figma list-item: border-t (border-test/secondary), pt-[16px], pr-[16px],
// gap-[12px] between content and amount.
const rowClasses = [
  "flex items-start justify-between gap-3 pt-4 pr-4",
  "border-t border-[color:var(--color-pipeline-line)]",
].join(" ");

// Row label: body font, 16px/22px, muted ink.
const labelClasses = [
  "flex flex-col gap-0.5",
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

// Caption "1:1 redeemable": body font, 12px/16px, muted ink.
const captionClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

// Row value: body font, 16px/22px, ink.
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

// Sub-section header: display serif, heading-s 20px/28px, normal weight, ink.
// Figma: font/title-font-family (display), font/font-size/heading-s (20px),
// font/line-height/heading-s (28px), content-test/primary (ink).
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
  // gap-4 (16px) between sub-section header and its rows, matching Figma card-horizontal gap-s.
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

// Column heading row: OUTSIDE the card border.
// Figma 3283:14281: items-baseline, justify-between.
const columnHeadingRowClasses = "flex items-baseline justify-between";

// Section name "Assets"/"Liabilities": display serif, heading-m 28px/36px, ink.
// Figma: font/title-font-family, font/font-size/heading-m (28px),
// font/line-height/heading-m (36px), content-test/primary.
// No mobile step-down here — Figma mobile frame uses the same heading-m size.
const columnTitleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// Muted rolled-up total: same size as section name, muted ink.
// Figma: font/title-font-family, heading-m 28px/36px, content-test/secondary.
const columnTotalClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

// Card body: white surface, asymmetric border (t:1px l:1px b:3px r:3px),
// border color = border-test/secondary = --color-pipeline-line,
// corner radius = radius-xxl (Figma) → --radius-pipeline-card (4px in our theme),
// padding = size-16 (16px) all sides, gap = size-32 (32px) between sub-sections.
// flex-1 ensures the Liabilities card grows to match the taller Assets card.
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
  // flex-1: both columns share equal width (50/50) in the parent flex-row.
  // flex-col so header row sits above the card.
  // gap-4 (16px) between header row and card — matches Figma Card Container gap-[16px].
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

// "Statement of Financial Position" heading.
// Figma 3283:14276: font/title-font-family (display serif), font/font-size/heading-l (48px),
// font/line-height/heading-l (56px), normal weight, content-test/primary (ink).
// Mobile: step down to heading-m (28px/36px) below md, matching Figma 3283:72288.
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
    /*
     * Borderless section wrapper — no outer Card chrome.
     * Figma 3283:14275 section frame is borderless; chrome lives on the
     * inner column cards only.
     * gap-8 (32px) = Figma size-32 between the title row and the Container.
     */
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
        /*
         * Figma 3283:14277 Container: flex-row, gap-[32px] between Card Containers,
         * items-start (top-aligned header rows) with cards stretching via flex-1.
         * On mobile (< md): flex-col, gap-8 between the stacked columns.
         * The 1px vertical divider (Figma 3283:14298) appears only on desktop.
         */
        <div className="flex flex-col gap-8 md:flex-row md:items-stretch">
          {/* Assets column */}
          <Column title="Assets" total={assets.total} testId="bs-col-assets">
            <SubSection title="Liquid" rows={assets.liquid} />
            <SubSection title="Deployed" rows={assets.deployed} />
          </Column>

          {/* Vertical divider (desktop only) — Figma 3283:14298, 1px wide, full height,
              border-test/secondary = --color-pipeline-line. Hidden on mobile. */}
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

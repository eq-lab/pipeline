import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  useLoansTable,
  LOAN_TABS,
  type LoanTab,
  type LoanTableRow,
  type LoansSummaryView,
} from "./-useLoansTable";
import { InlineError } from "@pipeline/ui";
import { useServedTargetChains } from "@/api/useChains";
import type { TargetChainOption } from "@/lib/targetChains";

/**
 * Loans — the Trustee list page at `/loans`; the sibling detail page lives at
 * `/loans/$id` (`loans.$id.tsx`), both under the pass-through `loans.tsx`
 * `<Outlet/>` layout.
 *
 * spec: docs/frontend/trustee-flows.md#loan-book--tables (layout, resolved
 * Open Questions, never-fabricate defaults, Figma → token mapping).
 */

// Figma body/card border literal, applied via inline `style` (not a Tailwind
// arbitrary class) so it always paints regardless of Tailwind v4 utility
// ordering — same precedent as `origination.index.tsx`.
const LINE_COLOR = "rgba(56, 55, 53, 0.18)";

// spec: trustee-flows.md#figma--token--px-mapping-loans-page-41169989.
const NEGATIVE_RED = "#b20000";
const ATTENTION_AMBER = "#6e6400";

const GRID_TEMPLATE_COLUMNS =
  "minmax(0,1.2fr) 90px minmax(0,1.7fr) minmax(0,1.2fr) minmax(0,1.1fr) minmax(0,1.3fr) 34px";

const GRID_TEMPLATE_COLUMNS_WITH_LTV =
  "minmax(0,1.1fr) 90px minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.15fr) 34px";

const COLUMN_HEADERS = [
  "Originator",
  "Chain",
  "Commodity",
  "Senior outst.",
  "Nearest payment",
  "Stage",
] as const;

const LTV_COLUMN_INDEX = 4;

const HEADER_CELL_CLASS =
  "flex flex-col items-start overflow-hidden px-[14px] pb-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink-muted)] whitespace-nowrap text-ellipsis";

const BODY_CELL_CLASS =
  "flex flex-col justify-center overflow-hidden px-[14px] py-[22px] font-[family-name:var(--font-body)] whitespace-nowrap";

/** Per-tab empty-state copy (resolved Open Question 2 for Default/Closed). */
const EMPTY_TAB_MESSAGE: Record<LoanTab, string> = {
  All: "No loans.",
  Active: "No active loans.",
  Watchlist: "No watchlist loans.",
  Default: "No defaulted loans.",
  Closed: "No closed loans.",
};

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  valueColor,
  sub,
}: {
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
}) {
  return (
    <div
      className="flex flex-col items-start rounded-[4px] bg-[color:var(--color-pipeline-surface)] px-[21px] py-[19px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
      data-testid="loans-summary-card"
    >
      <p className="font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px] text-[color:var(--color-pipeline-ink-muted)]">
        {label}
      </p>
      <p
        className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px]"
        style={{ color: valueColor ?? "var(--color-pipeline-ink)" }}
      >
        {value}
      </p>
      {sub != null && (
        <p className="pt-[6px] font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px] text-[color:var(--color-pipeline-ink-muted)]">
          {sub}
        </p>
      )}
    </div>
  );
}

function SummaryCards({ summary }: { summary: LoansSummaryView }) {
  return (
    <div
      className="grid w-full grid-cols-2 items-stretch gap-[14px] pt-[4px] md:grid-cols-3 lg:grid-cols-5"
      data-testid="loans-summary"
    >
      <SummaryCard label="Deployed senior" value={summary.deployedSenior} />
      <SummaryCard
        label="At-risk (WL + Default)"
        value={summary.atRiskPct}
        valueColor={NEGATIVE_RED}
        sub={summary.atRiskSenior}
      />
      <SummaryCard label="Weighted rate" value={summary.weightedRate} />
      <SummaryCard label="Weighted tenor" value={summary.weightedTenor} />
      <SummaryCard
        label="Top concentration"
        value={summary.topConcentrationPct}
        sub={summary.topConcentrationSub}
      />
    </div>
  );
}

// ── Tab bar ─────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  counts,
  onSelect,
}: {
  activeTab: LoanTab;
  counts: Record<LoanTab, number>;
  onSelect: (tab: LoanTab) => void;
}) {
  return (
    <div
      className="flex items-start gap-[2px] self-start rounded-[4px] bg-[rgba(191,189,187,0.12)] p-[4px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
      role="tablist"
      aria-label="Loan status filter"
      data-testid="loans-tabs"
    >
      {LOAN_TABS.map((tab) => {
        const active = tab === activeTab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab)}
            data-testid={`loans-tab-${tab}`}
            className={`flex items-center gap-[8px] rounded-[4px] px-[16px] py-[9px] font-[family-name:var(--font-body)] text-[16px] whitespace-nowrap ${
              active
                ? "bg-[color:var(--color-pipeline-surface)] text-[color:var(--color-pipeline-ink)]"
                : "text-[color:var(--color-pipeline-ink-muted)]"
            }`}
          >
            {tab}
            <span className="text-[14px] text-[color:var(--color-pipeline-ink-muted)]">
              {counts[tab]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Chain filter ─────────────────────────────────────────────────────────────

const ALL_CHAINS = "all";

function ChainFilter({
  value,
  options,
  disabled,
  onChange,
}: {
  value: number | null;
  options: ReadonlyArray<TargetChainOption>;
  disabled: boolean;
  onChange: (chainId: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-[8px] font-[family-name:var(--font-body)] text-[14px] text-[color:var(--color-pipeline-ink-muted)]">
      Chain
      <select
        data-testid="loans-chain-filter"
        aria-label="Chain filter"
        value={value == null ? ALL_CHAINS : String(value)}
        disabled={disabled}
        onChange={(e) =>
          onChange(
            e.target.value === ALL_CHAINS
              ? null
              : Number.parseInt(e.target.value, 10),
          )
        }
        className="rounded-[4px] bg-[color:var(--color-pipeline-surface)] px-[12px] py-[9px] text-[16px] text-[color:var(--color-pipeline-ink)]"
        style={{ border: `1px solid ${LINE_COLOR}` }}
      >
        <option value={ALL_CHAINS}>All chains</option>
        {options.map((chain) => (
          <option key={chain.id} value={String(chain.id)}>
            {chain.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

function CommodityCell({ row }: { row: LoanTableRow }) {
  return (
    <div
      role="cell"
      className={`${BODY_CELL_CLASS} gap-[2px] text-[color:var(--color-pipeline-ink)]`}
    >
      <span
        className="overflow-hidden text-[16px] leading-[22.4px] text-ellipsis"
        title={row.commodity}
      >
        {row.commodity}
      </span>
    </div>
  );
}

function LtvCellView({ row }: { row: LoanTableRow }) {
  if (row.ltv == null) {
    return <div role="cell" className={BODY_CELL_CLASS} />;
  }
  const { text, marginCallOpen, priceStale } = row.ltv;
  return (
    <div role="cell" className={`${BODY_CELL_CLASS} gap-[2px]`}>
      <span
        className="text-[16.5px] leading-[23.1px] font-bold"
        style={{
          color: marginCallOpen ? NEGATIVE_RED : "var(--color-pipeline-ink)",
        }}
        data-testid="loans-ltv"
        data-margin-call={marginCallOpen}
        data-price-stale={priceStale}
      >
        {text}
      </span>
      {(marginCallOpen || priceStale) && (
        <span className="text-[12.5px] leading-[17.5px]">
          {marginCallOpen && (
            <span style={{ color: NEGATIVE_RED }}>Margin call</span>
          )}
          {marginCallOpen && priceStale && " · "}
          {priceStale && (
            <span style={{ color: ATTENTION_AMBER }}>Price stale</span>
          )}
        </span>
      )}
    </div>
  );
}

function LoanRow({
  row,
  isFirst,
  showLtvColumn,
  onOpen,
}: {
  row: LoanTableRow;
  isFirst: boolean;
  showLtvColumn: boolean;
  onOpen: (row: LoanTableRow) => void;
}) {
  return (
    <div
      data-testid="loans-row"
      role="row"
      tabIndex={0}
      aria-label={`Open ${row.originator} loan`}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          // Prevent Space from scrolling the page.
          e.preventDefault();
          onOpen(row);
        }
      }}
      className="grid cursor-pointer items-stretch"
      style={{
        gridTemplateColumns: showLtvColumn
          ? GRID_TEMPLATE_COLUMNS_WITH_LTV
          : GRID_TEMPLATE_COLUMNS,
        // Separator BETWEEN rows only — the first row's top edge is the box border.
        borderTop: isFirst ? undefined : `1px solid ${LINE_COLOR}`,
      }}
    >
      <div
        role="cell"
        title={row.originator}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] font-semibold text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.originator}
      </div>
      <div
        role="cell"
        data-testid={`loans-chain-cell-${row.key}`}
        title={row.chain}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.chain}
      </div>
      <CommodityCell row={row} />
      <div
        role="cell"
        title={row.seniorOutstanding}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.seniorOutstanding}
      </div>
      {showLtvColumn && <LtvCellView row={row} />}
      <div
        role="cell"
        data-testid="loans-nearest-payment"
        data-overdue={row.nearestPayment.overdue}
        title={row.nearestPayment.text}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis`}
        style={{
          color: row.nearestPayment.overdue
            ? NEGATIVE_RED
            : "var(--color-pipeline-ink)",
        }}
      >
        {row.nearestPayment.text}
      </div>
      <div
        role="cell"
        title={row.stage}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink-muted)]`}
      >
        {row.stage}
      </div>
      {/* Trailing chevron — the row-click navigates to /loans/$id (decorative glyph). */}
      <div
        role="cell"
        aria-hidden="true"
        className={`${BODY_CELL_CLASS} items-end text-[16px] leading-[22.4px] text-[color:var(--color-pipeline-ink-muted)]`}
      >
        ›
      </div>
    </div>
  );
}

function LoansTable({
  activeTab,
  rows,
  showLtvColumn,
  onOpenLoan,
}: {
  activeTab: LoanTab;
  rows: LoanTableRow[];
  showLtvColumn: boolean;
  onOpenLoan: (row: LoanTableRow) => void;
}) {
  const headers = showLtvColumn
    ? [
        ...COLUMN_HEADERS.slice(0, LTV_COLUMN_INDEX),
        "LTV",
        ...COLUMN_HEADERS.slice(LTV_COLUMN_INDEX),
      ]
    : COLUMN_HEADERS;
  return (
    <div
      className="w-full"
      role="table"
      aria-label="Active loans"
      data-testid="loans-table"
    >
      {/* Header row — sits ABOVE the bordered box, unbordered (Origination precedent). */}
      <div
        role="row"
        className="grid items-start"
        style={{
          gridTemplateColumns: showLtvColumn
            ? GRID_TEMPLATE_COLUMNS_WITH_LTV
            : GRID_TEMPLATE_COLUMNS,
        }}
      >
        {headers.map((label) => (
          <div key={label} role="columnheader" className={HEADER_CELL_CLASS}>
            {label}
          </div>
        ))}
        {/* Trailing chevron column has no header label. */}
        <div
          role="columnheader"
          aria-hidden="true"
          className={HEADER_CELL_CLASS}
        />
      </div>

      {rows.length === 0 ? (
        <p
          data-testid="loans-empty"
          className="rounded-[4px] px-[14px] py-[28px] font-[family-name:var(--font-body)] text-[16px] text-[color:var(--color-pipeline-ink-muted)]"
          style={{ border: `1px solid ${LINE_COLOR}` }}
        >
          {EMPTY_TAB_MESSAGE[activeTab]}
        </p>
      ) : (
        // Bordered body box — the ONLY border in the table: a rounded box around
        // the rows + horizontal separators. Top edge 2px (box + first row stack).
        <div
          className="rounded-[4px]"
          style={{ border: `1px solid ${LINE_COLOR}`, borderTopWidth: "2px" }}
        >
          {rows.map((row, i) => (
            <LoanRow
              key={row.key}
              row={row}
              isFirst={i === 0}
              showLtvColumn={showLtvColumn}
              onOpen={onOpenLoan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LtvFootnote() {
  return (
    <div
      className="pt-[18px] font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-[color:var(--color-pipeline-ink-muted)]"
      data-testid="loans-footnote"
    >
      <p>
        LTV = amount owed (outstanding principal plus accrued interest) /
        security value, from the Stellar security registry. A margin call opens
        above the loan&apos;s margin-call ratio. Stellar loans only.
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function LoansIndex() {
  const [activeTab, setActiveTab] = useState<LoanTab>("All");
  const [chainFilter, setChainFilter] = useState<number | null>(null);
  const navigate = useNavigate();
  const targetChains = useServedTargetChains();
  const {
    state,
    errorMessage,
    errorDetails,
    summary,
    counts,
    rows,
    showLtvColumn,
  } = useLoansTable(activeTab, chainFilter);

  const openLoan = (row: LoanTableRow) =>
    void navigate({
      to: "/loans/$id",
      params: { id: row.loanId },
      search: { chain: row.chainId },
    });

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[26px] px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
        Loans
      </h1>

      {state === "error" ? (
        <div
          data-testid="loans-error"
          className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
        >
          <InlineError
            message={errorMessage ?? "Failed to load the loan book."}
            details={errorDetails ?? undefined}
          />
        </div>
      ) : state === "loading" || summary == null ? (
        <div
          data-testid="loans-loading"
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading loans"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[80px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      ) : (
        <>
          <SummaryCards summary={summary} />
          <div className="flex w-full flex-wrap items-center justify-between gap-[12px]">
            <TabBar
              activeTab={activeTab}
              counts={counts}
              onSelect={setActiveTab}
            />
            <ChainFilter
              value={chainFilter}
              options={targetChains.options}
              disabled={targetChains.isLoading}
              onChange={setChainFilter}
            />
          </div>
          {/* White surface card (Figma "Background" 4116:10040) — the "Payments
              due" banner + "Record coupon" action are OMITTED (resolved Open
              Question 3: no /v1/loan-book data source). */}
          <div className="flex w-full flex-col rounded-[4px] bg-[color:var(--color-pipeline-surface)] pt-[36px] pr-[32px] pb-[32px] pl-[32px]">
            <LoansTable
              activeTab={activeTab}
              rows={rows}
              showLtvColumn={showLtvColumn}
              onOpenLoan={openLoan}
            />
            {showLtvColumn && <LtvFootnote />}
          </div>
        </>
      )}
    </main>
  );
}

export const Route = createFileRoute("/loans/")({
  component: LoansIndex,
});

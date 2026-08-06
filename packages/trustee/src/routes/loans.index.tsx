import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  useLoansTable,
  LOAN_TABS,
  type CcrBand,
  type LoanTab,
  type LoanTableRow,
  type LoansSummaryView,
} from "./-useLoansTable";

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

// CCR band colors + At-risk/negative-spot red. spec:
// trustee-flows.md#figma--token--px-mapping-loans-page-41169989.
const NEGATIVE_RED = "#b20000";
const ATTENTION_AMBER = "#6e6400";
const MARGIN_CALL_ORANGE = "#b35900";
const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";

// Flexible column tracks (Figma's relative proportions) + a fixed 34px
// trailing chevron column — same approach as the Origination table.
const GRID_TEMPLATE_COLUMNS =
  "minmax(0,1.3fr) minmax(0,1.6fr) minmax(0,1.1fr) minmax(0,0.9fr) minmax(0,0.85fr) minmax(0,1fr) minmax(0,1.15fr) 34px";

const COLUMN_HEADERS = [
  "Originator",
  "Commodity · spot",
  "Senior outst.",
  "Collateral",
  "CCR",
  "Nearest payment",
  "Stage",
] as const;

const HEADER_CELL_CLASS =
  "flex flex-col items-start overflow-hidden px-[14px] pb-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink-muted)] whitespace-nowrap text-ellipsis";

const BODY_CELL_CLASS =
  "flex flex-col justify-center overflow-hidden px-[14px] py-[22px] font-[family-name:var(--font-body)] whitespace-nowrap";

/** Per-tab empty-state copy (resolved Open Question 2 for Default/Closed). */
const EMPTY_TAB_MESSAGE: Record<LoanTab, string> = {
  Performing: "No performing loans.",
  Watchlist: "No watchlist loans.",
  Default: "No defaulted loans.",
  Closed: "No closed loans.",
};

/** CCR band → text colour (healthy green token, attention/pre-default one-offs). */
function ccrBandColor(band: CcrBand | null): string {
  switch (band) {
    case "healthy":
      return POSITIVE_GREEN;
    case "attention":
      return ATTENTION_AMBER;
    case "margin-call":
      return MARGIN_CALL_ORANGE;
    case "pre-default":
      return NEGATIVE_RED;
    default:
      return "var(--color-pipeline-ink-muted)";
  }
}

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
      {row.spot != null && (
        <span
          className="overflow-hidden text-[12.5px] leading-[17.5px] text-ellipsis"
          style={{
            color: row.spot.negative
              ? NEGATIVE_RED
              : "var(--color-pipeline-ink-muted)",
          }}
        >
          {row.spot.text}
        </span>
      )}
    </div>
  );
}

function CcrCellView({ row }: { row: LoanTableRow }) {
  if (row.ccr == null) {
    return (
      <div
        role="cell"
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-[color:var(--color-pipeline-ink-muted)]`}
      >
        —
      </div>
    );
  }
  return (
    <div role="cell" className={`${BODY_CELL_CLASS} gap-[2px]`}>
      <span
        className="text-[16.5px] leading-[23.1px] font-bold"
        style={{ color: ccrBandColor(row.ccr.band) }}
        data-testid="loans-ccr"
        data-band={row.ccr.band ?? "none"}
      >
        {row.ccr.percent}
      </span>
      {row.ccr.age !== "—" && (
        <span className="text-[12px] leading-[16.8px] text-[color:var(--color-pipeline-ink-muted)]">
          {row.ccr.age}
        </span>
      )}
    </div>
  );
}

function LoanRow({
  row,
  isFirst,
  onOpen,
}: {
  row: LoanTableRow;
  isFirst: boolean;
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
        gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
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
      <CommodityCell row={row} />
      <div
        role="cell"
        title={row.seniorOutstanding}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.seniorOutstanding}
      </div>
      <div
        role="cell"
        title={row.collateral}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.collateral}
      </div>
      <CcrCellView row={row} />
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
  onOpenLoan,
}: {
  activeTab: LoanTab;
  rows: LoanTableRow[];
  onOpenLoan: (row: LoanTableRow) => void;
}) {
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
        style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
      >
        {COLUMN_HEADERS.map((label) => (
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
              onOpen={onOpenLoan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * CCR-band footnote (Figma node `4116:10111`). Static explanatory text with the
 * spec's four coloured band spans (#939): ≥130% healthy · 120–130% watchlist ·
 * 110–120% margin call · <110% hard margin call.
 */
function CcrFootnote() {
  return (
    <div
      className="pt-[18px] font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-[color:var(--color-pipeline-ink-muted)]"
      data-testid="loans-footnote"
    >
      <p>
        CCR = collateral value / outstanding senior, recomputed off-chain every
        60 min.{" "}
        <span className="font-semibold" style={{ color: POSITIVE_GREEN }}>
          ≥130%
        </span>{" "}
        healthy ·{" "}
        <span className="font-semibold" style={{ color: ATTENTION_AMBER }}>
          120–130%
        </span>{" "}
        watchlist ·{" "}
        <span className="font-semibold" style={{ color: MARGIN_CALL_ORANGE }}>
          110–120%
        </span>{" "}
        margin call ·{" "}
        <span className="font-semibold" style={{ color: NEGATIVE_RED }}>
          &lt;110%
        </span>{" "}
        hard margin call.
      </p>
      <p>Written on-chain only at threshold crossings.</p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function LoansIndex() {
  const [activeTab, setActiveTab] = useState<LoanTab>("Performing");
  const navigate = useNavigate();
  const { state, errorMessage, summary, counts, rows } =
    useLoansTable(activeTab);

  const openLoan = (row: LoanTableRow) =>
    void navigate({ to: "/loans/$id", params: { id: row.loanId } });

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[26px] px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
        Loans
      </h1>

      {state === "error" ? (
        <div
          role="alert"
          data-testid="loans-error"
          className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
        >
          {errorMessage ?? "Failed to load the loan book."}
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
          <TabBar
            activeTab={activeTab}
            counts={counts}
            onSelect={setActiveTab}
          />
          {/* White surface card (Figma "Background" 4116:10040) — the "Payments
              due" banner + "Record coupon" action are OMITTED (resolved Open
              Question 3: no /v1/loan-book data source). */}
          <div className="flex w-full flex-col rounded-[4px] bg-[color:var(--color-pipeline-surface)] pt-[36px] pr-[32px] pb-[32px] pl-[32px]">
            <LoansTable
              activeTab={activeTab}
              rows={rows}
              onOpenLoan={openLoan}
            />
            <CcrFootnote />
          </div>
        </>
      )}
    </main>
  );
}

export const Route = createFileRoute("/loans/")({
  component: LoansIndex,
});

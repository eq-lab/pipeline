/**
 * LoanBookTable — active-loan table for the Loan Book panel.
 *
 * All viewports: a semantic `<table>` with 7 columns matching the Figma
 *   header row: Borrower / Commodity, Principal, Collateral, LTV, Duration,
 *   Rate, Protection. Wrapped in `overflow-x: auto` so it horizontally scrolls
 *   at mobile widths where the full 1024px table exceeds the 370px content
 *   area (FRONTEND.md wide-content rule).
 *
 *   The Figma XS mobile frame `3283-71053` renders the full 7-column table
 *   scrolling horizontally inside the section — NOT stacked label/value cards.
 *   The previous `MobileCards` path (block md:hidden) has been removed to
 *   match Figma exactly (resolved decision for issue #749).
 *
 *   Column widths are derived from Figma node 3283-14552 (Table container):
 *     Borrower/Commodity — flexible (fills remaining space), min-w 1px
 *     Principal          — 112px  (node 3704:1076 Item width)
 *     Collateral         — 112px  (node 3704:1079 Item width)
 *     LTV                — 112px  (node 3704:1082 Item width)
 *     Duration           — 96px   (node 3704:1085 Item width)
 *     Rate               — 96px   (node 3704:1088 Item width)
 *     Protection         — 128px  (node 3704:1091 Item width)
 *   `table-layout: fixed` + `<colgroup>` enforces these widths so long hash
 *   strings in the borrower column do not push the numeric columns together.
 *   The borrower cell is `truncate` (overflow-hidden + text-ellipsis +
 *   whitespace-nowrap) so any overflow is clipped with an ellipsis.
 *
 *   Spacing derived from Figma node 3283-14552 metadata:
 *     Row height:         64px  (.row h=64, node 3704:1095)
 *     Row padding:        py-3  (12px top+bottom; .row py-[var(--size-12)])
 *     Header→row gap:     pb-2  (8px after header; Table container
 *                                gap-[var(--size-8)] between Header+Content)
 *     Inter-column gap:   pr-3  (12px right on first cell; row Slot
 *                                gap-[var(--size-12)] between list-items)
 *     Row divider:        border-t 1px --color-pipeline-line-subtle on <td>
 *                                (border-test/secondary light-mode = #F1F1F1;
 *                                on <td> cells, not <tr>, so border-collapse
 *                                renders them correctly)
 *
 *   Typography:
 *     Header captions:   12px / 16px, font-normal, --color-pipeline-ink-muted
 *                        (font/font-size/caption + font/line-height/caption)
 *     Body cells:        16px / 22px, font-normal, --color-pipeline-ink
 *                        (font/font-size/body + font/line-height/body = 22px)
 *
 * Figma references:
 *   Desktop:         https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431
 *   Table container: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14552
 *   Mobile (XS):     https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-71053
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
   * Optional pre-formatted aggregate strings for the column headers.
   * When present, the Principal and Collateral headers render as
   * `"Principal · $31.6M"` (label + middot + aggregate in one caption run).
   *
   * Applies at all viewports — the table is now rendered at every width
   * (no separate MobileCards path). Aggregates appear in the header row.
   */
  headerAggregates?: LoanBookHeaderAggregates;
}

// ── Token class constants ─────────────────────────────────────────────────────

// Column-header cells: 12px/16px caption token (font/font-size/caption +
// font/line-height/caption). The label and aggregate are one continuous caption
// run joined by a middot ` · `.
// `whitespace-nowrap` + `overflow-hidden` prevents wrapping / clips on narrow
// columns (fixed layout makes this a graceful fallback only).
//
// `pb-2` (8px bottom padding): Figma Table container uses gap-[var(--size-8)]
// between the Header slot (h=24) and the Content slot (starts y=32) — 8px gap.
// In `border-collapse` mode, the `border-b` on the header cells is the divider
// line; the 8px padding provides the visual separation below the header text.
// Token: --color-pipeline-line-subtle = #F1F1F1 (row divider, user dev-mode).
const headerCellClasses = [
  "text-left",
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "pb-2",
  "border-b border-[color:var(--color-pipeline-line-subtle)]",
  "whitespace-nowrap",
  "overflow-hidden",
].join(" ");

// Body cells — two padding layers matching Figma geometry (node 3283-14552):
//   Layer 1 — <td> py-3 (12px): the `.row` Slot starts at y=12 from the row
//             top edge (Figma: Slot y=12 inside the 64px .row).
//             Token: --size-12 / var(--size-12, 12px).
//   Layer 2 — inner <span> py-2 (8px): the `list-item` starts at y=8 inside
//             the Slot (Figma: list-item y=8 within Slot h=40).
//             Token: --size-8 / var(--size-8, 8px).
//   Combined: 12px + 8px = 20px from the row edge to the text top, with 24px
//             text (22px line-height + line box rounding), then 8px + 12px = 20px
//             below → 64px total row height matching Figma .row h=64.
//
// `border-t` on <td> (not <tr>) — border-collapse renders cell borders
//   reliably; <tr> borders are unreliable in some browser table paths.
// Token: --color-pipeline-line-subtle = #F1F1F1 (row divider, user dev-mode).
const bodyCellClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
  "py-3",
  "whitespace-nowrap",
  "border-t border-[color:var(--color-pipeline-line-subtle)]",
].join(" ");

// Cell text inner wrapper: py-2 (8px) is the second padding layer (list-item
// y=8 inside Slot). Applied as className on a <span> wrapping each cell value.
const bodyCellInnerClasses = "block py-2";

// First column (borrower/commodity): <td> gets py-3 + border-t (same as
// bodyCellClasses), overflow-hidden + max-w-0 forces the truncation boundary.
// The inner <span> carries truncate + py-2 so the ellipsis renders on the text
// itself while the <td> controls the overflow clip.
const firstBodyCellClasses = [
  "font-[family-name:var(--font-body)]",
  "font-normal",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
  "py-3",
  "overflow-hidden",
  "max-w-0",
  "border-t border-[color:var(--color-pipeline-line-subtle)]",
].join(" ");

// Inner span for the borrower cell: truncate (overflow-hidden + text-ellipsis
// + whitespace-nowrap) + py-2 (8px second padding layer).
const firstBodyCellInnerClasses = "block truncate py-2";

// ── Table (all viewports) ─────────────────────────────────────────────────────

function LoanTable({ rows, headerAggregates }: LoanBookTableProps) {
  const agg = headerAggregates ?? {};
  return (
    <div
      className="w-full overflow-x-auto"
      data-testid="loan-book-table-desktop"
    >
      {/*
       * table-layout: fixed — columns respect the <col> widths rather than
       * sizing to content, preventing the borrower hash from squashing the
       * numeric columns. The borrower column has no explicit <col> width so
       * it takes all remaining space (Figma: flex-[1_0_0]).
       *
       * Column widths from Figma node 3283-14552 (Table container metadata):
       *   Principal 112px · Collateral 112px · LTV 112px
       *   Duration 96px · Rate 96px · Protection 128px
       *   Total fixed: 656px — remainder goes to Borrower/Commodity.
       *
       * border-collapse: row dividers are on <td>/<th> cells (not <tr>)
       * because <tr> border rendering is unreliable in border-separate mode.
       * border-collapse correctly merges the header border-b with the first
       * body cell border-t into a single 1px line.
       */}
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {/* Borrower/Commodity — flexible, fills remaining width */}
          <col />
          <col style={{ width: "112px" }} />
          <col style={{ width: "112px" }} />
          <col style={{ width: "112px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "128px" }} />
        </colgroup>
        <thead>
          {/*
           * Header <tr> has no border class — the border-b is on each <th>
           * via headerCellClasses. border-collapse merges the <th> border-b
           * with the first body <td> border-t into a single 1px #F1F1F1 line.
           */}
          <tr>
            <th className={[headerCellClasses, "pr-3"].join(" ")}>
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
            // Row borders are on <td> cells (bodyCellClasses/firstBodyCellClasses)
            // not on <tr> — see table border-collapse comment above.
            // Figma also specifies border-radius: 4px on rows; unsupported on
            // <tr> — logged as TD-26 in tech-debt-tracker.md.
            <tr key={i}>
              {/*
               * pr-3 on <td>: 12px right gap matching Figma Slot
               * gap-[var(--size-12)] between the borrower list-item and
               * the Principal list-item.
               * Inner span carries truncate + py-2 (second padding layer).
               */}
              <td className={[firstBodyCellClasses, "pr-3"].join(" ")}>
                <span className={firstBodyCellInnerClasses}>
                  {row.borrowerCommodity}
                </span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.principal}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.collateral}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.ltv}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.duration}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.rate}</span>
              </td>
              <td className={bodyCellClasses}>
                <span className={bodyCellInnerClasses}>{row.protection}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── LoanBookTable ─────────────────────────────────────────────────────────────

/**
 * Renders the active-loan table at all viewport widths.
 *
 * Mobile (below `md`): the full 7-column table horizontally scrolls inside
 * its `overflow-x-auto` wrapper (Figma XS frame `3283-71053` — the table
 * container is w=1024 inside a 370px section). The previous stacked-card
 * `MobileCards` path has been removed (issue #749 resolved decision).
 *
 * Desktop (`md+`): same table, no horizontal scroll needed at full width.
 *
 * `headerAggregates` populates the Principal and Collateral header subtitles
 * at all widths.
 */
export function LoanBookTable({ rows, headerAggregates }: LoanBookTableProps) {
  return (
    <div data-testid="loan-book-table">
      <LoanTable rows={rows} headerAggregates={headerAggregates} />
    </div>
  );
}

export default LoanBookTable;

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TRUSTEE_NAV_ITEMS } from "@/lib/nav";
import {
  useOriginationTable,
  type OriginationTableRow,
} from "./-useOriginationTable";

/**
 * Origination — the real page (issue #813, Figma node `4116:9155`, table card
 * `4116:9159`), replacing the #786 placeholder body. A page heading + a white
 * card containing a submissions table driven by live data from
 * `GET /v1/loan-book/submissions` (via `useOriginationTable` →
 * `useLoanSubmissions`).
 *
 * Columns (left to right): Originator · Commodity · Facility · Corridor ·
 * Rate · Maturity · Submitted · Status/action.
 *
 * Resolved open questions (human, issue #813 comment):
 *   - The Figma "Commodity · valuation" sub-line ("NSR · Net Smelter Return" /
 *     "Standard · price × quantity") is OMITTED — no data source reachable
 *     pre-mint exists for the valuation mode, and it must not be inferred
 *     from the commodity string (see `-useOriginationTable.ts` docs).
 *   - Status/action column: `Approved` → green "Approved & minted · <date>"
 *     pill; `InReview` → a "Review" control that navigates to
 *     `/origination/$id` (issue #821), passing the row's `SubmissionView` as
 *     router state; `Rejected` → red "Rejected" pill with `reason` on hover.
 *   - The Figma static footer note ("The document set adapts to the
 *     commodity…") is deliberately OMITTED per human review follow-up on
 *     this issue — kept out of the page even though it's present in the
 *     Figma reference.
 *
 * ## Row-click navigation (issue #823)
 *
 * The ENTIRE row (not just the InReview "Review" control) navigates to
 * `/origination/$id`, for ALL statuses — including Approved/Rejected rows,
 * whose status cell is a non-interactive pill. Each row is a
 * `role="row"` `div` with `tabIndex={0}`, an `aria-label`, and an
 * `onClick`/`onKeyDown` (Enter/Space) calling `useNavigate()`. It is
 * deliberately NOT an `<a>`/`<Link>` wrapper — nesting the row anchor around
 * the InReview `StatusCell`'s own `<Link>` would produce invalid nested
 * anchors. The InReview Review `Link` is kept as-is (so it remains its own
 * focusable, screen-reader-navigable control per the Figma) but its `onClick`
 * calls `stopPropagation()` so a click on it doesn't also fire the row's
 * handler (both target the same URL — this just avoids a duplicated
 * navigation/history entry, see the exec plan's Assumptions section).
 *
 * ## Layout — full-width CSS grid (not an HTML `<table>`)
 *
 * The table fills 100% of the card width via `grid-template-columns`: seven
 * flexible data tracks in the Figma's relative proportions + a fixed 210px
 * action column (see `GRID_TEMPLATE_COLUMNS`). Reproducing the Figma frame's
 * literal fixed pixel widths overflowed the card and clipped the right
 * edge/action column — its export widths are internally inconsistent (body
 * cells total ~1038px inside a 945px box) — so the flexible model is used
 * instead. Each cell truncates with an ellipsis (`overflow-hidden
 * text-ellipsis`, full value in a `title` tooltip) so nothing wraps/collides.
 *
 * Pixel/token mapping from the Figma export:
 *   - Header cells: `pb-[12px] px-[14px]`, `14px` Inter regular,
 *     `--color-pipeline-ink-muted` (exact match for the Figma
 *     `rgba(56,55,53,0.6)` text). The header row sits ABOVE the bordered box.
 *   - Body cells: `px-[14px] py-[28px]` (≈80px rows, matching the Figma
 *     single-line row height). The bordered body box + inter-row separators
 *     use `LINE_COLOR` (the exact Figma `rgba(56,55,53,0.18)`), applied via
 *     inline `style` so it always paints regardless of any Tailwind v4
 *     utility-ordering quirk; the box top edge is 2px (vs 1px sides/separators)
 *     to match the Figma, where the box border and first row's border stack.
 *   - Originator: `16px` Inter semibold, `--color-pipeline-ink` (exact match
 *     for the Figma `#262524` literal).
 *   - Commodity/Facility/Corridor/Rate/Maturity: `16px` Inter regular,
 *     `--color-pipeline-ink`.
 *   - Submitted: `16px` Inter regular, `--color-pipeline-ink-muted` (muted,
 *     per Figma — distinct from the other data cells).
 *   - Approved pill: `rgba(32,128,0,0.08)` bg, `rgba(32,128,0,0.3)` border,
 *     `#208000` text — exact match for `--color-pipeline-positive-primary`
 *     on the text and the check icon; bg/border alpha steps have no token
 *     match (one-offs, same precedent as the Capital Allocation legend
 *     colors). The check icon (Figma node `4116:9216`, a localhost dev-server
 *     SVG asset not fetchable at runtime) is redrawn inline as `CheckIcon`.
 *   - Review button: `#000080` bg (exact match `--color-pipeline-brand`),
 *     white text, `rounded-[4px]`, `15px` Inter regular, `h-[36px]`. Live
 *     navigation as of issue #821 (previously an inert placeholder).
 *   - Rejected pill: no Figma reference row exists for this status (resolved
 *     via the issue's Open Questions as a "sensible token-consistent
 *     default") — mirrors the Approved pill's shape with
 *     `--color-pipeline-negative` (`#c0392b`) in place of the green tokens.
 */
const navItem = TRUSTEE_NAV_ITEMS.find((t) => t.path === "/origination")!;

/**
 * Column track sizing. The Figma frame (`4116:9159`) uses FIXED pixel widths
 * that sum wider than the card (its body cells total ~1038px inside a 945px
 * box — an export artifact), so reproducing them literally overflowed the
 * card and clipped the right edge / action column. Instead the table fills
 * 100% of the card width: the seven data columns are flexible tracks in the
 * Figma's relative proportions (`minmax(0, Nfr)` so they can shrink and
 * ellipsis-truncate rather than overflow), and the action column is a fixed
 * 210px (matching Figma) so the "Approved & minted · <date>" pill / Review
 * button always fit and are never cut. Total = exactly 100%, no horizontal
 * scroll/clip.
 */
const GRID_TEMPLATE_COLUMNS =
  "minmax(0,1.4fr) minmax(0,1.7fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,0.7fr) minmax(0,1fr) minmax(0,0.8fr) 210px";

/**
 * Row/table border color — the exact Figma literal (`rgba(56,55,53,0.18)`,
 * node `4116:9159`), applied via inline `style` rather than a Tailwind
 * arbitrary-value border class so it always paints regardless of any Tailwind
 * v4 utility-ordering quirk. The table draws borders ONLY around the body
 * content: a single rounded box enclosing the data rows, plus a horizontal
 * separator between rows. There are NO vertical/column dividers and NO
 * per-cell borders — the header row sits ABOVE the box, unbordered.
 */
const LINE_COLOR = "rgba(56, 55, 53, 0.18)";

const COLUMN_HEADERS = [
  "Originator",
  "Commodity",
  "Facility",
  "Corridor",
  "Rate",
  "Maturity",
  "Submitted",
] as const;

const HEADER_CELL_CLASS =
  "flex flex-col items-start overflow-hidden px-[14px] pb-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink-muted)] whitespace-nowrap text-ellipsis";

const BODY_CELL_CLASS =
  "flex flex-col items-start justify-center overflow-hidden px-[14px] py-[28px] font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] whitespace-nowrap text-ellipsis";

/**
 * CheckIcon — small circular checkmark glyph used inside the Approved pill
 * (Figma node `4116:9216`). Painted with `currentColor` so it inherits the
 * pill's green text color. Trustee-local (mirrors `LockIcon`'s precedent) —
 * promote to `@pipeline/ui` if a second consumer appears.
 */
function CheckIcon(props: React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={13}
      height={13}
      {...props}
    >
      <path
        d="M3 6.5L5.5 9L10 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusCell({ row }: { row: OriginationTableRow }) {
  const { status } = row;
  switch (status.kind) {
    case "approved":
      return (
        <span
          className="inline-flex h-[22.8px] items-center gap-[5px] rounded-[4px] border border-solid border-[rgba(32,128,0,0.3)] bg-[rgba(32,128,0,0.08)] px-[6px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[color:var(--color-pipeline-positive-primary)]"
          data-testid="origination-status-approved"
        >
          <CheckIcon />
          {status.label}
        </span>
      );
    case "in-review":
      return (
        <Link
          to="/origination/$id"
          params={{ id: String(row.id) }}
          state={{ submission: row.submission }}
          aria-label="Review submission"
          data-testid="origination-status-review"
          // The row itself also navigates on click (issue #823) — stop
          // propagation so this doesn't ALSO fire the row's handler (both
          // target the same URL; this just avoids a duplicated history
          // entry).
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-[36px] items-center rounded-[4px] bg-[color:var(--color-pipeline-brand)] px-[12px] font-[family-name:var(--font-body)] text-[15px] text-white"
        >
          {status.label}
        </Link>
      );
    case "rejected":
      return (
        <span
          className="inline-flex h-[22.8px] items-center gap-[6px] rounded-[4px] border border-solid border-[rgba(192,57,43,0.3)] bg-[rgba(192,57,43,0.08)] px-[8px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[color:var(--color-pipeline-negative)]"
          data-testid="origination-status-rejected"
          title={status.reason ?? undefined}
        >
          {status.label}
        </span>
      );
    default:
      return (
        <span
          className="font-[family-name:var(--font-body)] text-[14px] text-[color:var(--color-pipeline-ink-muted)]"
          data-testid="origination-status-unknown"
        >
          {status.label}
        </span>
      );
  }
}

function OriginationTable() {
  const { state, errorMessage, rows } = useOriginationTable();
  const navigate = useNavigate();

  function goToDetail(row: OriginationTableRow) {
    void navigate({
      to: "/origination/$id",
      params: { id: String(row.id) },
      state: { submission: row.submission },
    });
  }

  if (state === "error") {
    return (
      <div
        role="alert"
        data-testid="origination-error"
        className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
      >
        {errorMessage ?? "Failed to load loan submissions."}
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div
        data-testid="origination-loading"
        className="flex w-full flex-col gap-3"
        aria-busy="true"
        aria-label="Loading loan submissions"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[60px] w-full animate-pulse rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface-muted)]"
          />
        ))}
      </div>
    );
  }

  if (state === "empty") {
    return (
      <p
        data-testid="origination-empty"
        className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)]"
      >
        No loans in origination.
      </p>
    );
  }

  return (
    <div
      className="w-full"
      data-testid="origination-table"
      role="table"
      aria-label="Loan submissions"
    >
      <div className="w-full">
        {/* Header row — sits ABOVE the bordered box, unbordered (Figma 4116:9159). */}
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
          {/* Status/action column has no header label in the Figma. */}
          <div
            role="columnheader"
            aria-hidden="true"
            className={HEADER_CELL_CLASS}
          />
        </div>

        {/* Bordered body box — the ONLY border in the table: a rounded box
            around the data rows + a horizontal separator between rows. No
            vertical/column dividers, no per-cell borders. The TOP edge is 2px
            (vs 1px sides/separators) to match Figma, where the box border and
            the first row's top border stack. */}
        <div
          className="rounded-[4px]"
          style={{ border: `1px solid ${LINE_COLOR}`, borderTopWidth: "2px" }}
        >
          {rows.map((row, i) => (
            <div
              key={row.id}
              data-testid="origination-row"
              role="row"
              tabIndex={0}
              aria-label={`Open ${row.originator} submission`}
              onClick={() => goToDetail(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  // Prevent Space from scrolling the page.
                  e.preventDefault();
                  goToDetail(row);
                }
              }}
              className="grid cursor-pointer items-stretch"
              style={{
                gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
                // Separator BETWEEN rows only — the first row's top edge is the
                // box border itself, so it gets no extra top border.
                borderTop: i === 0 ? undefined : `1px solid ${LINE_COLOR}`,
              }}
            >
              <div
                role="cell"
                title={row.originator}
                className={`${BODY_CELL_CLASS} font-semibold text-[color:var(--color-pipeline-ink)]`}
              >
                {row.originator}
              </div>
              <div
                role="cell"
                title={row.commodity}
                className={`${BODY_CELL_CLASS} text-[color:var(--color-pipeline-ink)]`}
              >
                {row.commodity}
              </div>
              <div
                role="cell"
                title={row.facility}
                className={`${BODY_CELL_CLASS} text-[color:var(--color-pipeline-ink)]`}
              >
                {row.facility}
              </div>
              <div
                role="cell"
                title={row.corridor}
                className={`${BODY_CELL_CLASS} text-[color:var(--color-pipeline-ink)]`}
              >
                {row.corridor}
              </div>
              <div
                role="cell"
                title={row.rate}
                className={`${BODY_CELL_CLASS} text-[color:var(--color-pipeline-ink)]`}
              >
                {row.rate}
              </div>
              <div
                role="cell"
                title={row.maturity}
                className={`${BODY_CELL_CLASS} text-[color:var(--color-pipeline-ink)]`}
              >
                {row.maturity}
              </div>
              <div
                role="cell"
                title={row.submitted}
                className={`${BODY_CELL_CLASS} text-[color:var(--color-pipeline-ink-muted)]`}
              >
                {row.submitted}
              </div>
              <div
                role="cell"
                data-testid={`origination-status-cell-${row.id}`}
                className={`${BODY_CELL_CLASS} items-end`}
              >
                <StatusCell row={row} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Origination() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[30px] px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
        {navItem.heading}
      </h1>
      {/* White surface per Figma "Background" node (4116:9159): bg-white,
          rounded-4px, 32px padding — NO border/shadow. The only border in the
          page is the table's own body box (see OriginationTable). */}
      <div className="flex w-full flex-col gap-0 rounded-[4px] bg-[color:var(--color-pipeline-surface)] p-[32px]">
        <OriginationTable />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/origination/")({
  component: Origination,
});

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TRUSTEE_NAV_ITEMS } from "@/lib/nav";
import {
  useOriginationTable,
  type OriginationTableRow,
} from "./-useOriginationTable";
import { InlineError } from "@pipeline/ui";

/**
 * Origination — the submissions table page, driven by live data from
 * `GET /v1/loan-book/submissions` (via `useOriginationTable` →
 * `useLoanSubmissions`).
 *
 * spec: docs/frontend/trustee-flows.md#origination-table-origination-issue-813
 * (columns, row-click navigation, layout, Figma → token mapping).
 */
const navItem = TRUSTEE_NAV_ITEMS.find((t) => t.path === "/origination")!;

// spec: docs/frontend/trustee-flows.md#origination-table-origination-issue-813 (Layout).
const GRID_TEMPLATE_COLUMNS =
  "minmax(0,1.2fr) minmax(0,1.6fr) 100px minmax(0,1.6fr) 80px 120px 100px 210px";

// Exact Figma literal, inline `style` so it always paints (Tailwind v4 ordering quirk).
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

// Cells must be BLOCK-level (not flex) for `text-overflow: ellipsis` to
// apply — on a flex container it silently does nothing and long values
// hard-clip mid-character (#1015). Single-line text centers vertically via
// the symmetric padding alone, so flex was never load-bearing here.
const HEADER_CELL_CLASS =
  "overflow-hidden px-[14px] pb-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink-muted)] whitespace-nowrap text-ellipsis";

const BODY_CELL_CLASS =
  "overflow-hidden px-[14px] py-[28px] font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] whitespace-nowrap text-ellipsis";

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
    case "changes-requested":
      // Sweet-orange caution pill (#950) — a non-final "waiting on originator"
      // state. Mirrors the Rejected pill's shape + reason-on-hover, but a
      // distinct, readable orange one-off (`#c2500a`, no token): not the red of
      // Rejected, the olive of InReview, or the green of Approved.
      return (
        <span
          className="inline-flex h-[22.8px] items-center gap-[6px] rounded-[4px] border border-solid border-[rgba(194,80,10,0.3)] bg-[rgba(194,80,10,0.08)] px-[8px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap text-[#c2500a]"
          data-testid="origination-status-changes-requested"
          title={status.reason ?? undefined}
        >
          {status.label}
        </span>
      );
  }
}

function OriginationTable() {
  const { state, errorMessage, errorDetails, rows } = useOriginationTable();
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
        data-testid="origination-error"
        className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
      >
        <InlineError
          message={errorMessage ?? "Failed to load loan submissions."}
          details={errorDetails ?? undefined}
        />
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
                // The one flex cell: holds elements (pill/button), not
                // truncatable text, and needs the right-alignment.
                className={`${BODY_CELL_CLASS} flex flex-col items-end justify-center`}
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
      <div className="flex flex-wrap items-end justify-between gap-[16px]">
        <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
          {navItem.heading}
        </h1>
        <Link
          to="/origination/new"
          data-testid="origination-submit-loan"
          className="flex h-[48px] items-center rounded-[4px] bg-[color:var(--color-pipeline-brand)] px-[24px] font-[family-name:var(--font-body)] text-[16px] text-white no-underline"
        >
          Submit a loan
        </Link>
      </div>
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

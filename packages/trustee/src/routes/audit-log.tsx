import { createFileRoute } from "@tanstack/react-router";
import { memo, useState } from "react";
import { useAuditLogView, type AuditRow } from "./-useAuditLog";

/**
 * Audit Log — the real Trustee page (issue #1004, Figma node `4116:13770`),
 * Surface 17 of epic #775, replacing the #786 placeholder body. Driven by live
 * `GET /v1/audit-log` data (via `useAuditLogView` → `useAuditLog`, Stellar-scoped
 * `chain_id`, 30 s poll), enriched with loan names from `useLoanBook`.
 *
 * Layout (top → bottom): the `Audit Log` heading · a white card holding the
 * append-only, reverse-chronological table (Time · Action · Loan / scope ·
 * Reference) · a caption. Mirrors the `loans.index.tsx` design language (shell,
 * heading, card, header-above-bordered-box table, tokens).
 *
 * ## On-chain only (resolved with the issue author)
 * The endpoint serves on-chain loan-lifecycle + yield events only. The rows are
 * whatever it returns — never fabricated. Two consequences vs. the Figma mock:
 *   - The mock's off-chain rows ("Batch off-ramp co-signed", "Loan
 *     distributions wired (fiat)") and non-loan "Batch #B-102" scopes will not
 *     appear until the backend off-chain-audit follow-up lands (#1000 header).
 *   - The caption is adapted from the Figma copy (which promises fiat wire
 *     confirmations + MPC co-signatures "all land here") to describe what is
 *     actually served today — no over-claiming, matching the loans-page
 *     "never fabricate" precedent.
 *
 * ## Figma → token / px mapping (matches the `loans.index.tsx` precedent)
 *   - Heading: `font-display text-[64px] leading-[64px] rgba(56,55,53,0.3)`.
 *   - Card: `bg-[--color-pipeline-surface] rounded-[4px] p-[32px]`.
 *   - Header cells `14px / ink-muted`, `pb-[12px] px-[14px]`; table draws
 *     borders ONLY around the body box + inter-row separators (`LINE_COLOR`),
 *     header row unbordered above the box.
 *   - Body cells `16px`, `py-[20px] px-[14px]`: Time + Reference ink-muted,
 *     Action + scope `#262524` ink. Reference is monospace 14px.
 *   - Action + Loan/scope wrap (a deliberate deviation from the Figma's
 *     single-line `nowrap` cells): audit actions run long and must stay fully
 *     readable — never truncate served data.
 *   - Caption `13px / ink-muted`, `leading-[18.2px]`, `pt-[16px]`.
 */

/**
 * The exact Figma body/card border literal (`rgba(56,55,53,0.18)`), applied via
 * inline `style` so it always paints regardless of Tailwind v4 utility ordering —
 * same precedent as `loans.index.tsx`.
 */
const LINE_COLOR = "rgba(56, 55, 53, 0.18)";

/** Monospace stack for the Reference (tx hash) column — Figma uses SF Mono. */
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Column tracks in the Figma's relative proportions (Time 123 · Action 415 ·
 * Loan/scope 245 · Reference 160), flexible `minmax(0,Nfr)` so the table fills
 * the card width and cells shrink rather than overflow. No horizontal scroll.
 */
const GRID_TEMPLATE_COLUMNS =
  "minmax(0,1.1fr) minmax(0,3.6fr) minmax(0,2.2fr) minmax(0,1.4fr)";

const COLUMN_HEADERS = ["Time", "Action", "Loan / scope", "Reference"] as const;

const HEADER_CELL_CLASS =
  "flex flex-col items-start overflow-hidden px-[14px] pb-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink-muted)] whitespace-nowrap text-ellipsis";

const BODY_CELL_CLASS =
  "flex flex-col justify-center px-[14px] py-[20px] font-[family-name:var(--font-body)] text-[16px] leading-[22.4px]";

/**
 * How many newest rows to render before the "Show older" reveal. The endpoint
 * returns the full unpaginated feed (#1004), so this caps the DOM row count to
 * keep first paint cheap regardless of feed size — a visible cap, never a silent
 * truncation. A backend `limit`/`cursor` follow-up would let us trim the payload
 * itself (see #1000's pagination open question); this only bounds rendering.
 */
const AUDIT_PAGE_SIZE = 50;

// ── Table ───────────────────────────────────────────────────────────────────

/**
 * Memoized so the 30 s background poll (`useAuditLog`) does not re-render every
 * row. TanStack Query structural-shares unchanged data, so `row` keeps its
 * identity across polls when nothing changed and `memo` skips the re-render.
 */
const AuditRowView = memo(function AuditRowView({
  row,
  isFirst,
}: {
  row: AuditRow;
  isFirst: boolean;
}) {
  return (
    <div
      data-testid="audit-row"
      role="row"
      className="grid items-stretch"
      style={{
        gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
        // Separator BETWEEN rows only — the first row's top edge is the box border.
        borderTop: isFirst ? undefined : `1px solid ${LINE_COLOR}`,
      }}
    >
      <div
        role="cell"
        className={`${BODY_CELL_CLASS} whitespace-nowrap text-[color:var(--color-pipeline-ink-muted)]`}
      >
        {row.time}
      </div>
      <div
        role="cell"
        className={`${BODY_CELL_CLASS} break-words text-[color:var(--color-pipeline-ink)]`}
      >
        {row.action}
      </div>
      <div
        role="cell"
        className={`${BODY_CELL_CLASS} break-words text-[color:var(--color-pipeline-ink)]`}
      >
        {row.scopeLabel}
      </div>
      <div
        role="cell"
        title={row.referenceFull}
        className={`${BODY_CELL_CLASS} text-[14px] leading-[19.6px] whitespace-nowrap text-[color:var(--color-pipeline-ink-muted)]`}
        style={{ fontFamily: MONO_FONT }}
      >
        {row.reference}
      </div>
    </div>
  );
});

function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div
      className="w-full"
      role="table"
      aria-label="Audit log"
      data-testid="audit-table"
    >
      {/* Header row — sits ABOVE the bordered box, unbordered (loans-page precedent). */}
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
      </div>

      {rows.length === 0 ? (
        <p
          data-testid="audit-empty"
          className="rounded-[4px] px-[14px] py-[28px] font-[family-name:var(--font-body)] text-[16px] text-[color:var(--color-pipeline-ink-muted)]"
          style={{ border: `1px solid ${LINE_COLOR}` }}
        >
          No audit events yet.
        </p>
      ) : (
        // Bordered body box — the ONLY border in the table: a rounded box around
        // the rows + horizontal separators. Top edge 2px (box + first row stack).
        <div
          className="rounded-[4px]"
          style={{ border: `1px solid ${LINE_COLOR}`, borderTopWidth: "2px" }}
        >
          {rows.map((row, i) => (
            <AuditRowView key={row.key} row={row} isFirst={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Caption — adapted from the Figma copy to describe what the v1 endpoint
 * actually serves (on-chain events), not the eventual off-chain feed.
 */
function AuditCaption() {
  return (
    <p
      className="pt-[16px] font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-[color:var(--color-pipeline-ink-muted)]"
      data-testid="audit-caption"
    >
      Append-only, newest first — on-chain loan-lifecycle and yield events
      appear here as they are indexed.
    </p>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function AuditLog() {
  const { state, errorMessage, rows } = useAuditLogView();
  const [visibleCount, setVisibleCount] = useState(AUDIT_PAGE_SIZE);

  // Cap rendered rows to the newest `visibleCount`; the feed is already newest
  // first, so slicing from the top keeps the ordering. New rows from the poll
  // stay within the cap without resetting the user's reveal.
  const visibleRows = rows.slice(0, visibleCount);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[26px] px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
        Audit Log
      </h1>

      {state === "error" ? (
        <div
          role="alert"
          data-testid="audit-error"
          className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
        >
          {errorMessage ?? "Failed to load the audit log."}
        </div>
      ) : state === "loading" ? (
        <div
          data-testid="audit-loading"
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading audit log"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[64px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      ) : (
        <div className="flex w-full flex-col rounded-[4px] bg-[color:var(--color-pipeline-surface)] p-[32px]">
          <AuditTable rows={visibleRows} />
          {hiddenCount > 0 && (
            <button
              type="button"
              data-testid="audit-show-more"
              onClick={() => setVisibleCount((c) => c + AUDIT_PAGE_SIZE)}
              className="mt-[16px] self-start rounded-[4px] px-[14px] py-[9px] font-[family-name:var(--font-body)] text-[14px] text-[color:var(--color-pipeline-ink-muted)]"
              style={{ border: `1px solid ${LINE_COLOR}` }}
            >
              Show older ({hiddenCount} more)
            </button>
          )}
          <AuditCaption />
        </div>
      )}
    </main>
  );
}

export const Route = createFileRoute("/audit-log")({
  component: AuditLog,
});

import { createFileRoute } from "@tanstack/react-router";
import { memo, useState } from "react";
import { useAuditLogView, type AuditRow } from "./-useAuditLog";

/**
 * Audit Log — the real Trustee page for `/audit-log` (Surface 17, issue #1004).
 *
 * spec: docs/frontend/trustee-flows.md#audit-log (architecture, on-chain-only
 * scope, unpaginated-feed rendering, Figma → token mapping).
 */

// Inline `style` (not a Tailwind class) so it always paints under v4 utility ordering.
const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";
const GRID_TEMPLATE_COLUMNS =
  "minmax(0,1.1fr) minmax(0,3.6fr) minmax(0,2.2fr) minmax(0,1.4fr)";

const COLUMN_HEADERS = ["Time", "Action", "Loan / scope", "Reference"] as const;

const HEADER_CELL_CLASS =
  "flex flex-col items-start overflow-hidden px-[14px] pb-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink-muted)] whitespace-nowrap text-ellipsis";

const BODY_CELL_CLASS =
  "flex flex-col justify-center px-[14px] py-[20px] font-[family-name:var(--font-body)] text-[16px] leading-[22.4px]";

const AUDIT_PAGE_SIZE = 50;

// memo: skip re-rendering unchanged rows on the 30 s poll (Query structural-shares data).
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
        // Body box — the table's only border (rounded box + row separators).
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

function AuditLog() {
  const { state, errorMessage, rows } = useAuditLogView();
  const [visibleCount, setVisibleCount] = useState(AUDIT_PAGE_SIZE);

  // Newest `visibleCount` only — feed is newest-first, so slice from the top.
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

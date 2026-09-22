import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { InlineError } from "@pipeline/ui";
import {
  useLpCounterpartiesTable,
  type AccountStatusBand,
  type LpCounterpartyRow,
} from "./-useLpCounterpartiesTable";

// spec: docs/frontend/trustee-flows.md#lp-counterparties.

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
const ATTENTION_AMBER = "#6e6400";
const NEGATIVE_RED = "#b20000";
const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";

const GRID_TEMPLATE_COLUMNS =
  "minmax(0,1.7fr) minmax(0,1fr) minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1fr) 34px";

const COLUMN_HEADERS = [
  "Legal Entity Name",
  "Jurisdiction",
  "First Registration Date",
  "Account Status",
  "Blockchain Address Available",
  "Bank Info Available",
] as const;

const HEADER_CELL_CLASS =
  "flex flex-col items-start overflow-hidden px-[14px] pb-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink-muted)] text-ellipsis";

const BODY_CELL_CLASS =
  "flex flex-col justify-center overflow-hidden px-[14px] py-[22px] font-[family-name:var(--font-body)] whitespace-nowrap";

function statusBandColor(band: AccountStatusBand): string {
  switch (band) {
    case "positive":
      return POSITIVE_GREEN;
    case "attention":
      return ATTENTION_AMBER;
    case "negative":
      return NEGATIVE_RED;
    default:
      return "var(--color-pipeline-ink-muted)";
  }
}

function LpCounterpartyRowView({
  row,
  isFirst,
  onOpen,
}: {
  row: LpCounterpartyRow;
  isFirst: boolean;
  onOpen: (row: LpCounterpartyRow) => void;
}) {
  return (
    <div
      data-testid="lp-counterparties-row"
      role="row"
      tabIndex={0}
      aria-label={`Open ${row.legalName}`}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(row);
        }
      }}
      className="grid cursor-pointer items-stretch"
      style={{
        gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
        borderTop: isFirst ? undefined : `1px solid ${LINE_COLOR}`,
      }}
    >
      <div
        role="cell"
        title={row.legalName}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] font-semibold text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.legalName}
      </div>
      <div
        role="cell"
        title={row.jurisdiction}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.jurisdiction}
      </div>
      <div
        role="cell"
        title={row.registeredOn}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.registeredOn}
      </div>
      <div
        role="cell"
        data-testid="lp-counterparties-status"
        data-band={row.status.band}
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] font-semibold text-ellipsis`}
        style={{ color: statusBandColor(row.status.band) }}
      >
        {row.status.label}
      </div>
      <div
        role="cell"
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink)]`}
      >
        {row.blockchainAddress}
      </div>
      <div
        role="cell"
        className={`${BODY_CELL_CLASS} text-[16px] leading-[22.4px] text-ellipsis text-[color:var(--color-pipeline-ink-muted)]`}
      >
        {row.bankInfo}
      </div>
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

function LpCounterpartiesTable({
  rows,
  onOpenRow,
}: {
  rows: LpCounterpartyRow[];
  onOpenRow: (row: LpCounterpartyRow) => void;
}) {
  return (
    <div
      className="w-full"
      role="table"
      aria-label="LP counterparties"
      data-testid="lp-counterparties-table"
    >
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
        <div
          role="columnheader"
          aria-hidden="true"
          className={HEADER_CELL_CLASS}
        />
      </div>

      {rows.length === 0 ? (
        <p
          data-testid="lp-counterparties-empty"
          className="rounded-[4px] px-[14px] py-[28px] font-[family-name:var(--font-body)] text-[16px] text-[color:var(--color-pipeline-ink-muted)]"
          style={{ border: `1px solid ${LINE_COLOR}` }}
        >
          No registered LP counterparties.
        </p>
      ) : (
        <div
          className="rounded-[4px]"
          style={{ border: `1px solid ${LINE_COLOR}`, borderTopWidth: "2px" }}
        >
          {rows.map((row, i) => (
            <LpCounterpartyRowView
              key={row.key}
              row={row}
              isFirst={i === 0}
              onOpen={onOpenRow}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LpCounterpartiesIndex() {
  const navigate = useNavigate();
  const { state, errorMessage, errorDetails, rows } =
    useLpCounterpartiesTable();

  const openRow = (row: LpCounterpartyRow) =>
    void navigate({ to: "/lp-counterparties/$id", params: { id: row.lpId } });

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[26px] px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
        LP Counterparties
      </h1>

      {state === "error" ? (
        <div
          data-testid="lp-counterparties-error"
          className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
        >
          <InlineError
            message={errorMessage ?? "Failed to load LP counterparties."}
            details={errorDetails ?? undefined}
          />
        </div>
      ) : state === "loading" ? (
        <div
          data-testid="lp-counterparties-loading"
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading LP counterparties"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[80px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      ) : (
        <div className="flex w-full flex-col rounded-[4px] bg-[color:var(--color-pipeline-surface)] pt-[36px] pr-[32px] pb-[32px] pl-[32px]">
          <LpCounterpartiesTable rows={rows} onOpenRow={openRow} />
        </div>
      )}
    </main>
  );
}

export const Route = createFileRoute("/lp-counterparties/")({
  component: LpCounterpartiesIndex,
});

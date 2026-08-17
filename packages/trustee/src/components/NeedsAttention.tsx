import { Link } from "@tanstack/react-router";
import { InlineError } from "@pipeline/ui";
import { OriginationIcon } from "./TrusteeNavIcons";
import { useNeedsAttention } from "./useNeedsAttention";

/**
 * NeedsAttention — the Trustee Overview page's "Needs Attention" section.
 *
 * spec: docs/frontend/trustee-flows.md#needs-attention-section (scope, row
 * sourcing incl. ChangesRequested #1046, why not a `Card`,
 * empty/loading/error handling, Figma → token mapping).
 */
const ROW_CLASS =
  "flex min-h-[72px] w-full items-center gap-[16px] rounded-[4px] border border-solid px-[17px] py-[15px]";
const ROW_STYLE = {
  backgroundColor: "rgba(211,235,117,0.16)",
  borderColor: "rgba(56,55,53,0.18)",
} as const;
const GROUP_LABEL_CLASS =
  "font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] text-[color:var(--color-pipeline-ink-muted)] uppercase";
const ACTION_CLASS =
  "flex h-[40px] shrink-0 items-center justify-center rounded-[4px] bg-[color:var(--color-pipeline-brand)] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white";

/** The lightbulb icon circle + the title/subtitle text block, shared by both groups. */
function RowBody({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <span
        className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-[color:var(--color-pipeline-brand)]"
        aria-hidden="true"
      >
        <OriginationIcon width={18} height={18} className="text-white" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <p className="truncate font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[color:var(--color-pipeline-ink)]">
          {title}
        </p>
        <p className="truncate font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] text-[color:var(--color-pipeline-ink-muted)]">
          {subtitle}
        </p>
      </div>
    </>
  );
}

export function NeedsAttention() {
  const { state, errorMessage, errorDetails, rows, loanRows } =
    useNeedsAttention();

  if (state === "error") {
    return (
      <div
        className="flex w-full flex-col items-start gap-[10px]"
        data-testid="needs-attention-error"
        aria-label="Needs Attention"
      >
        <h2 className="font-[family-name:var(--font-display)] text-[36px] leading-[46px] text-[color:var(--color-pipeline-ink)]">
          Needs Attention
        </h2>
        <div className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]">
          <InlineError
            message={
              errorMessage ?? "Failed to load the Needs Attention items."
            }
            details={errorDetails ?? undefined}
          />
        </div>
      </div>
    );
  }

  if (state !== "ready" || (rows.length === 0 && loanRows.length === 0)) {
    return null;
  }

  return (
    <div
      className="flex w-full flex-col items-start gap-[10px]"
      data-testid="needs-attention"
      aria-label="Needs Attention"
    >
      <h2 className="font-[family-name:var(--font-display)] text-[36px] leading-[46px] text-[color:var(--color-pipeline-ink)]">
        Needs Attention
      </h2>

      {rows.length > 0 && (
        <div
          className="flex w-full flex-col items-start gap-[14px]"
          data-testid="needs-attention-origination"
        >
          <p className={GROUP_LABEL_CLASS}>Origination</p>

          <div className="flex w-full flex-col gap-3">
            {rows.map((row) => (
              <div
                key={row.id}
                data-testid="needs-attention-row"
                className={ROW_CLASS}
                style={ROW_STYLE}
              >
                <RowBody title={row.title} subtitle={row.subtitle} />
                <Link
                  to="/origination/$id"
                  params={{ id: String(row.id) }}
                  state={{ submission: row.submission }}
                  aria-label="Review submission"
                  data-testid="needs-attention-review"
                  className={ACTION_CLASS}
                >
                  Review
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {loanRows.length > 0 && (
        <div
          className="flex w-full flex-col items-start gap-[14px]"
          data-testid="needs-attention-loans"
        >
          <p className={GROUP_LABEL_CLASS}>Loans</p>

          <div className="flex w-full flex-col gap-3">
            {loanRows.map((row) => (
              <div
                key={row.loanId}
                data-testid="needs-attention-loan-row"
                className={ROW_CLASS}
                style={ROW_STYLE}
              >
                <RowBody title={row.title} subtitle={row.subtitle} />
                <Link
                  to="/loans/$id"
                  params={{ id: row.loanId }}
                  aria-label={`Open ${row.title}`}
                  data-testid="needs-attention-open"
                  className={ACTION_CLASS}
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default NeedsAttention;

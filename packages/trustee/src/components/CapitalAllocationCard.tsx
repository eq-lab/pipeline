import { Card } from "@pipeline/ui";
import { useCapitalAllocationCard } from "./useCapitalAllocationCard";

/**
 * CapitalAllocationCard — the Trustee Overview page's "Capital Allocation"
 * card (Figma node `4116:8928`, frame `4116-8854`), issue #797.
 *
 * Net scope for this issue (see `docs/exec-plans/active/issue-797-*.md`
 * "Decisions" section, human-confirmed 2026-07-08):
 *   - Big total (`formatFullUsd`), fully-expanded whole dollars.
 *   - An inert, non-proportional placeholder bar — styled per Figma but NOT
 *     driven by `bucket/total` (no client-computed percentages/proportions;
 *     see [no frontend-computed metrics]). A follow-up wires the real bar
 *     once the backend serves proportion/percentage fields.
 *   - Per-bucket legend (Capital Wallet / In transit / Trust account /
 *     Deployed / T-Bills (USYC)) with compact dollar values, "—" for null.
 *
 * Explicitly deferred/omitted (not built here): the green reconciliation
 * header ("RECONCILES TO PLUSD BACKING · DRIFT < …"), the 4 provenance
 * chips, and any percentage labels — none have a backing API field.
 *
 * Pixel/token mapping from the Figma export:
 *   - Card: white surface, `rounded-[4px]` → `--radius-pipeline-card`,
 *     `p-[32px]`.
 *   - Header label: Inter/body 16px, `--color-pipeline-ink`.
 *   - Total: Besley display, Figma `text-[58px]/leading-[81.2px]`, ink token.
 *   - Bar segment / legend dot colours: `#000080` → `--color-pipeline-brand`
 *     (exact match), `#208000` → `--color-pipeline-positive-primary` (exact
 *     match). `#c9a200` and `#6666b3` have no matching token — scoped
 *     one-offs, same precedent as `SignInCard`'s blur effect and #786's
 *     unbadged nav items. The mid grey segment
 *     (`rgba(56,55,53,0.35)`) is a darker alpha step of the ink token family
 *     than any existing muted/subtle token, so it is also a scoped one-off.
 */
export function CapitalAllocationCard() {
  const { isLoading, isError, errorMessage, totalDisplay, legend } =
    useCapitalAllocationCard();

  return (
    <Card
      variant="white"
      padding="none"
      className="flex w-full flex-col gap-4 p-8"
      data-testid="capital-allocation-card"
    >
      <div className="flex w-full items-baseline justify-between">
        <span className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]">
          Capital Allocation
        </span>
      </div>

      {isError ? (
        <div
          role="alert"
          data-testid="capital-allocation-error"
          className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
        >
          {errorMessage ?? "Failed to load Capital Allocation data."}
        </div>
      ) : isLoading ? (
        <div
          data-testid="capital-allocation-skeleton"
          className="flex w-full flex-col gap-4"
          aria-busy="true"
          aria-label="Loading Capital Allocation"
        >
          <div className="h-[58px] w-64 animate-pulse rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface-muted)]" />
          <div className="flex w-full flex-wrap gap-4">
            {legend.map((row) => (
              <div
                key={row.key}
                className="h-5 w-32 animate-pulse rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface-muted)]"
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className="font-[family-name:var(--font-display)] text-[58px] leading-[81.2px] tracking-[0.5px] text-[color:var(--color-pipeline-ink)]">
            {totalDisplay}
          </p>

          {/* Inert, non-proportional placeholder bar (decision #1) — styled per
              Figma's segmented look but every segment is equal width. NOT
              driven by bucket/total; do not compute percentages here. */}
          <div
            className="flex h-2 w-full overflow-hidden rounded-[2px]"
            role="presentation"
            data-testid="capital-allocation-bar"
          >
            {legend.map((row) => (
              <div
                key={row.key}
                className="h-full flex-1"
                style={{ backgroundColor: row.color }}
              />
            ))}
          </div>

          <div className="flex w-full flex-wrap gap-x-6 gap-y-3">
            {legend.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
                <span className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]">
                  {row.label} {row.value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export default CapitalAllocationCard;

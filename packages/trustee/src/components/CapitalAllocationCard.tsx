import type { ReactNode } from "react";
import { Card, InlineError } from "@pipeline/ui";
import { useCapitalAllocationCard } from "./useCapitalAllocationCard";

/**
 * CapitalAllocationCard — the Trustee Overview page's "Capital Allocation"
 * card.
 *
 * spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer
 * (scope, removed mock chrome, percentage pills, allocation bar, `children`
 * composition, Figma → token mapping).
 */

export interface CapitalAllocationCardProps {
  /** Extra content rendered inside the same white `Card`, directly after this component's own content. */
  children?: ReactNode;
}

export function CapitalAllocationCard({
  children,
}: CapitalAllocationCardProps = {}) {
  const {
    isLoading,
    isError,
    errorMessage,
    errorDetails,
    totalDisplay,
    legend,
  } = useCapitalAllocationCard();

  return (
    <Card
      variant="white"
      padding="none"
      // spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer (children composition).
      className="flex w-full flex-col gap-12 p-8"
      data-testid="capital-allocation-card"
    >
      <div className="flex w-full flex-col gap-4">
        <div className="flex w-full items-baseline justify-between">
          <span className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]">
            Capital Allocation
          </span>
        </div>

        {isError ? (
          <div
            data-testid="capital-allocation-error"
            className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
          >
            <InlineError
              message={
                errorMessage ?? "Failed to load Capital Allocation data."
              }
              details={errorDetails ?? undefined}
            />
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

            {/* spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer (allocation bar). */}
            <div
              className="flex h-2 w-full overflow-hidden rounded-[2px]"
              role="presentation"
              data-testid="capital-allocation-bar"
            >
              {legend
                .filter((row) => row.barFraction !== null)
                .map((row) => (
                  <div
                    key={row.key}
                    className="h-full"
                    style={{
                      backgroundColor: row.color,
                      width: `${(row.barFraction as number) * 100}%`,
                    }}
                    data-testid={`capital-allocation-bar-segment-${row.key}`}
                  />
                ))}
            </div>

            <div className="flex w-full flex-wrap items-end gap-x-6 gap-y-3">
              {legend.map((row) => (
                <div key={row.key} className="flex items-end gap-2">
                  {/* spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer (percentage pills). */}
                  {row.percentDisplay !== null && (
                    <span
                      className="relative flex h-[16.8px] shrink-0 items-center rounded-[4px] bg-[rgba(191,189,187,0.12)] pl-[4px]"
                      data-testid={`capital-allocation-percent-${row.key}`}
                    >
                      <span
                        className="size-[8px] shrink-0 rounded-[2px]"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                      <span className="pr-[5px] pl-[5px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] text-[rgba(56,55,53,0.6)]">
                        {row.percentDisplay}
                      </span>
                    </span>
                  )}
                  {row.percentDisplay === null && (
                    <span
                      className="size-2 shrink-0 self-center rounded-[2px]"
                      style={{ backgroundColor: row.color }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]">
                    {row.label} {row.value}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {children}
    </Card>
  );
}

export default CapitalAllocationCard;

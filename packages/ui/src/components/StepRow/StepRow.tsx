import React from "react";
import { Button } from "../Button";
import { InlineError } from "../InlineError/InlineError";

/**
 * StepRow — numbered step row used inside `StepsCard`.
 * spec: docs/frontend/ui-components.md#steprow
 */

export interface StepRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Step number rendered inside the numbered square (e.g. 1, 2, …). */
  step: number;
  /** Descriptive label for the step (e.g. "Allow contract to use USDC"). */
  label: string;
  /** Label for the trailing action button (e.g. "Approve", "Convert"). */
  actionLabel: string;
  /** When true, the row dims and the action button is inert. Defaults to `false`. */
  disabled?: boolean;
  /** Called when the action button is clicked (only fires when not disabled). */
  onAction?: React.MouseEventHandler<HTMLButtonElement>;
  /** When true, the action button is disabled and shows an in-flight spinner. */
  loading?: boolean;
  /**
   * Step state: "idle" (default), "success" (check pill replaces the action),
   * or "error" (retry kept — spec: docs/frontend/wallet-flows.md#step-error-state).
   */
  state?: "idle" | "success" | "error";
  /** Red message line under the label; rendered only when `state` is `"error"`. */
  errorMessage?: string;
  /**
   * Raw error text for the details dialog — never rendered inline.
   * spec: docs/frontend/error-handling.md
   */
  errorDetails?: string;
}

const rootClasses = [
  "flex items-center gap-3",
  "w-full",
  "transition-opacity duration-150",
].join(" ");

const stepCircleClasses = [
  "flex items-center justify-center",
  "size-10 shrink-0",
  "rounded-[var(--radius-pipeline-card)]",
  "bg-[var(--color-pipeline-line)]",
].join(" ");

const stepNumberClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-bold)]",
  "text-[color:var(--color-pipeline-ink)]",
  "select-none",
].join(" ");

const labelClasses = [
  "flex-1 min-w-0",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

export const StepRow = React.forwardRef<HTMLDivElement, StepRowProps>(
  function StepRow(
    {
      step,
      label,
      actionLabel,
      disabled = false,
      onAction,
      loading = false,
      state = "idle",
      errorMessage,
      errorDetails,
      className,
      ...rest
    },
    ref,
  ) {
    const isSuccess = state === "success";
    const isError = state === "error";

    const composed = [
      rootClasses,
      disabled && !isSuccess && !isError && !loading ? "opacity-30" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        ref={ref}
        data-testid={`step-row-${step}`}
        className={composed}
        {...rest}
      >
        {/* Error tint via inline styles (not class overrides) so it
            deterministically beats the base classes regardless of Tailwind emit order. */}
        <div
          data-testid={`step-row-${step}-badge`}
          className={stepCircleClasses}
          style={
            isError ? { backgroundColor: "rgba(192, 57, 43, 0.12)" } : undefined
          }
          aria-hidden="true"
        >
          <span
            className={stepNumberClasses}
            style={
              isError ? { color: "var(--color-pipeline-negative)" } : undefined
            }
          >
            {step}
          </span>
        </div>

        {/* A <div>, not a <span>: `InlineError` can render `ErrorDetailsDialog`'s
            backdrop <div> as a descendant, which is not valid inside a <span>. */}
        <div className={labelClasses}>
          {label}
          {isError && errorMessage && (
            <InlineError
              message={errorMessage}
              details={errorDetails}
              className="mt-0.5 block"
            />
          )}
        </div>

        <div data-testid={`step-row-${step}-action`} className="shrink-0 p-1">
          {isSuccess ? (
            <div
              className={[
                "inline-flex items-center justify-center",
                "h-8 w-22",
                "rounded-[var(--radius-pipeline-button)]",
                "bg-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
              aria-label={`${actionLabel} complete`}
              data-state="success"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M3.5 10.5L8 15.5L16.5 5"
                  stroke="var(--color-pipeline-on-dark)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          ) : (
            <Button
              variant="primary-dark"
              disabled={disabled || loading}
              onClick={onAction}
              /* !h-8 (important modifier) so the height override reliably beats
                 the h-12 from the primary-dark variant class in Tailwind v4. */
              className="!h-8 w-22 min-w-0 text-[length:var(--text-pipeline-body)]"
              aria-busy={loading}
            >
              {loading ? (
                /* CSS-only spinner kept inline — no new exported primitive */
                <span
                  className={[
                    "inline-block",
                    "size-4 rounded-full",
                    "border-2 border-[color:var(--color-pipeline-on-dark)]",
                    "border-t-transparent",
                    "animate-spin",
                  ].join(" ")}
                  aria-hidden="true"
                />
              ) : (
                actionLabel
              )}
            </Button>
          )}
        </div>
      </div>
    );
  },
);

StepRow.displayName = "StepRow";

export default StepRow;

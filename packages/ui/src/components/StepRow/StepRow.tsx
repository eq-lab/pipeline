import React from "react";
import { Button } from "../Button";

/**
 * StepRow — numbered step row used inside `StepsCard`.
 *
 * Renders a numbered circle/square (e.g. `1`) + a label
 * (e.g. `Allow contract to use USDC`) + a trailing action `Button`
 * (e.g. `Approve` / `Convert`).
 *
 * Figma reference: node 1498-100694 (card-horizontal / List item)
 *   — node I1498:100694;8980:3384;1498:100676  (step 1, disabled)
 *   — node I1498:100694;8980:3384;1498:100685  (step 2, disabled)
 *
 * Disabled state matches Figma: entire row rendered at 30% opacity
 * (`opacity-30`). The action button additionally receives the HTML
 * `disabled` attribute so it is inert.
 */

export interface StepRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Step number rendered inside the numbered square (e.g. 1, 2, …). */
  step: number;
  /** Descriptive label for the step (e.g. "Allow contract to use USDC"). */
  label: string;
  /** Label for the trailing action button (e.g. "Approve", "Convert"). */
  actionLabel: string;
  /**
   * When true, the row renders at 30% opacity and the action button is
   * inert. Defaults to `false`.
   */
  disabled?: boolean;
  /** Called when the action button is clicked (only fires when not disabled). */
  onAction?: React.MouseEventHandler<HTMLButtonElement>;
  /**
   * When true, the action button is disabled and shows an in-flight spinner
   * to communicate that a transaction is pending. Full row opacity is kept so
   * the user can see the progress state clearly.
   */
  loading?: boolean;
  /**
   * Step state:
   *   - `"idle"` (default) — renders the normal action button.
   *   - `"success"` — keeps the numeric step badge on the left and replaces
   *     the action button on the right with a wide green pill containing a
   *     centred check icon (Figma node 1497-95272).
   */
  state?: "idle" | "success";
}

const rootClasses = [
  "flex items-center gap-3",
  "w-full",
  "transition-opacity duration-150",
].join(" ");

/** 40 × 40 px numbered square with muted fill — matches Figma `image` node. */
const stepCircleClasses = [
  "flex items-center justify-center",
  "size-10 shrink-0",
  "rounded-[var(--radius-pipeline-card)]",
  "bg-[var(--color-pipeline-line)]",
].join(" ");

const stepNumberClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-heading-s)]",
  "leading-[var(--text-pipeline-heading-s--line-height)]",
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
  "truncate",
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
      className,
      ...rest
    },
    ref,
  ) {
    const isSuccess = state === "success";

    // When disabled and not in a special state, apply 30% opacity.
    // Success and loading rows always render at full opacity so the user can
    // see the check badge / spinner clearly.
    const composed = [
      rootClasses,
      disabled && !isSuccess && !loading ? "opacity-30" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        {/* Numbered square — always visible, including in success state */}
        <div className={stepCircleClasses} aria-hidden="true">
          <span className={stepNumberClasses}>{step}</span>
        </div>

        {/* Label */}
        <span className={labelClasses}>{label}</span>

        {/* Action button / loading spinner wrapper — matches Figma `ButtonCont` */}
        <div className="shrink-0 p-1">
          {isSuccess ? (
            /* Success state: wide green pill with check icon — matches Figma node 1497-95272 */
            <div
              className={[
                "inline-flex items-center justify-center",
                "h-8 w-22",
                "rounded-[var(--radius-pipeline-pill)]",
                "bg-[color:var(--color-pipeline-positive-secondary)]",
              ].join(" ")}
              aria-label={`${actionLabel} complete`}
              data-state="success"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M3 8.5L6.5 12L13 5"
                  stroke="var(--color-pipeline-positive)"
                  strokeWidth="2"
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
              /* Override default 48px height to the 32px height used in the
                 step card (Figma button height: min-h-[32px] w-[88px]). */
              className="h-8 w-22 min-w-0 text-[length:var(--text-pipeline-body)]"
              aria-busy={loading}
            >
              {loading ? (
                /* Inline CSS-only spinner — no new exported primitive */
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

import React from "react";
import { Card } from "../Card";
import { StepRow } from "../StepRow/StepRow";

/**
 * StepsCard — renders a list of `StepRow` items inside a `muted` `Card` surface.
 * spec: docs/frontend/ui-components.md#stepscard
 */

export interface StepItem {
  /** Descriptive label for the step (e.g. "Allow contract to use USDC"). */
  label: string;
  /** Label for the trailing action button (e.g. "Approve", "Convert"). */
  actionLabel: string;
  /** When true, the step row dims and the action button is inert. Defaults to `false`. */
  disabled?: boolean;
  /** Called when the action button is clicked (only fires when not disabled). */
  onAction?: React.MouseEventHandler<HTMLButtonElement>;
  /** When true the action button shows a loading / in-flight state. */
  loading?: boolean;
  /** Step state — see `StepRow`'s `state` prop. */
  state?: "idle" | "success" | "error";
  /** Red message line under the label; rendered only when `state` is `"error"`. */
  errorMessage?: string;
  /** Raw error text for the details dialog — see `StepRow.errorDetails`. */
  errorDetails?: string;
}

export interface StepsCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Ordered list of steps to render. Each item maps 1:1 to a `StepRow`.
   * Step numbers are derived from the array index (1-based).
   */
  steps: StepItem[];
}

export const StepsCard = React.forwardRef<HTMLDivElement, StepsCardProps>(
  function StepsCard({ steps, className, ...rest }, ref) {
    return (
      <Card
        ref={ref}
        variant="muted"
        // `!` important prefix so per-side widths reliably beat the uniform
        // `border` shorthand in Card's baseClasses regardless of cascade order.
        className={[
          "!border-t !border-r-[3px] !border-b-[3px] !border-l",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        <div data-testid="steps-list" className="flex flex-col gap-2">
          {steps.map(
            (
              {
                label,
                actionLabel,
                disabled,
                onAction,
                loading,
                state,
                errorMessage,
                errorDetails,
              },
              index,
            ) => (
              <StepRow
                key={index}
                step={index + 1}
                label={label}
                actionLabel={actionLabel}
                disabled={disabled}
                onAction={onAction}
                loading={loading}
                errorMessage={errorMessage}
                errorDetails={errorDetails}
                state={state}
              />
            ),
          )}
        </div>
      </Card>
    );
  },
);

StepsCard.displayName = "StepsCard";

export default StepsCard;

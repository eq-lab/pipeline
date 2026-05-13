import React from "react";
import { Card } from "../Card";
import { StepRow } from "../StepRow/StepRow";

/**
 * StepsCard — a thin wrapper that renders a list of `StepRow` items inside
 * a `muted` `Card` surface.
 *
 * Used on the deposit/conversion screen to guide the user through a numbered
 * sequence of on-chain actions (e.g. Approve token spend, then Convert).
 *
 * Figma reference: node 1498-100130 (StepsCard container with two step rows).
 *
 * Props:
 *   - `steps` — ordered array of step descriptors. Each entry maps 1:1 to a
 *     `StepRow`. Minimum two items expected (Approve + Convert), but the
 *     component accepts any number.
 *
 * The card's inner padding (`p-6`) comes from `Card`. The step rows are
 * stacked with a `gap-2` (8 px) gutter matching the Figma spacing.
 */

export interface StepItem {
  /** Descriptive label for the step (e.g. "Allow contract to use USDC"). */
  label: string;
  /** Label for the trailing action button (e.g. "Approve", "Convert"). */
  actionLabel: string;
  /**
   * When true, the step row renders at 30% opacity and the action button is
   * inert. Defaults to `false`.
   */
  disabled?: boolean;
  /** Called when the action button is clicked (only fires when not disabled). */
  onAction?: React.MouseEventHandler<HTMLButtonElement>;
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
      <Card ref={ref} variant="muted" className={className} {...rest}>
        <div className="flex flex-col gap-2">
          {steps.map(({ label, actionLabel, disabled, onAction }, index) => (
            <StepRow
              key={index}
              step={index + 1}
              label={label}
              actionLabel={actionLabel}
              disabled={disabled}
              onAction={onAction}
            />
          ))}
        </div>
      </Card>
    );
  },
);

StepsCard.displayName = "StepsCard";

export default StepsCard;

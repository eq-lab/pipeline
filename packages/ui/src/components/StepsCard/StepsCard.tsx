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
  /**
   * When true the action button shows a loading / in-flight state (disabled
   * with a spinner). The row opacity remains full so the user sees progress.
   */
  loading?: boolean;
  /**
   * Step state:
   *   - `"idle"` (default) — renders the action button normally.
   *   - `"success"` — replaces the action button with a green check badge,
   *     indicating this step has been completed.
   */
  state?: "idle" | "success";
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
        // Figma node 1498-100130: asymmetric border — 1px on left + top,
        // 3px on right + bottom — producing a subtle "stamped" elevation effect.
        // Use `!` important prefix so per-side widths reliably beat the uniform
        // `border` shorthand in Card's baseClasses regardless of Tailwind's
        // CSS cascade order. Border colour is inherited from the muted variant's
        // border-color token (--color-pipeline-line).
        className={[
          "!border-t !border-r-[3px] !border-b-[3px] !border-l",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        <div className="flex flex-col gap-2">
          {steps.map(
            (
              { label, actionLabel, disabled, onAction, loading, state },
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

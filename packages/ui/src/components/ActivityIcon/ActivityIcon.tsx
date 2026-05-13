import React from "react";
import checkCircleSrc from "../../assets/icons/check-circle.svg";
import clockPendingSrc from "../../assets/icons/clock-pending.svg";
import arrowUpCircleSrc from "../../assets/icons/arrow-up-circle.svg";
import arrowDownCircleSrc from "../../assets/icons/arrow-down-circle.svg";
import exchangeSrc from "../../assets/icons/exchange.svg";

/**
 * ActivityIcon — 40 × 40 ink-filled tile that leads every transaction row.
 *
 * Renders a 20 px white icon centered inside a 40 × 40 square tile with:
 *   - Ink-fill background (`--color-pipeline-ink`)
 *   - `rounded-pipeline-card` corner radius (`--radius-pipeline-card`)
 *   - White icon rendered via CSS filter (`brightness(0) invert(1)`) so any
 *     SVG asset — regardless of its original fill colour — is displayed as
 *     pure white on the dark background.
 *
 * Icon map:
 *   - `check-circle`    — completed / success transaction
 *   - `clock-pending`   — pending transaction
 *   - `arrow-up-circle` — send / withdraw
 *   - `arrow-down-circle` — receive / deposit
 *   - `exchange`        — exchange / swap
 *
 * Accessibility: decorative by default (`aria-hidden="true"`).  Pass an
 * explicit `aria-label` to make the icon meaningful to assistive tech.
 *
 * Figma reference: node 1497-94912.
 */

export type ActivityIconVariant =
  | "check-circle"
  | "clock-pending"
  | "arrow-up-circle"
  | "arrow-down-circle"
  | "exchange";

export interface ActivityIconProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which icon to display. */
  icon: ActivityIconVariant;
}

const ICON_SRC: Record<ActivityIconVariant, string> = {
  "check-circle": checkCircleSrc,
  "clock-pending": clockPendingSrc,
  "arrow-up-circle": arrowUpCircleSrc,
  "arrow-down-circle": arrowDownCircleSrc,
  exchange: exchangeSrc,
};

const ICON_LABEL: Record<ActivityIconVariant, string> = {
  "check-circle": "Completed",
  "clock-pending": "Pending",
  "arrow-up-circle": "Sent",
  "arrow-down-circle": "Received",
  exchange: "Exchange",
};

const tileClasses = [
  "inline-flex items-center justify-center",
  "size-10 shrink-0",
  "rounded-[var(--radius-pipeline-card)]",
  "bg-[var(--color-pipeline-ink)]",
].join(" ");

export const ActivityIcon = React.forwardRef<HTMLDivElement, ActivityIconProps>(
  function ActivityIcon(
    {
      icon,
      "aria-label": ariaLabel,
      "aria-hidden": ariaHidden,
      className,
      ...rest
    },
    ref,
  ) {
    const src = ICON_SRC[icon];
    const defaultLabel = ICON_LABEL[icon];

    // Decorative by default; becomes meaningful when caller supplies aria-label.
    const isHidden = ariaLabel == null ? true : (ariaHidden ?? false);

    const composed = [tileClasses, className].filter(Boolean).join(" ");

    return (
      <div
        ref={ref}
        className={composed}
        aria-hidden={isHidden || undefined}
        aria-label={ariaLabel}
        role={ariaLabel != null ? "img" : undefined}
        {...rest}
      >
        {/* 20 px icon, forced white via CSS filter */}
        <img
          src={src}
          alt={ariaLabel ?? defaultLabel}
          width={20}
          height={20}
          aria-hidden="true"
          style={{ filter: "brightness(0) invert(1)" }}
        />
      </div>
    );
  },
);

ActivityIcon.displayName = "ActivityIcon";

export default ActivityIcon;

import React from "react";
import checkCircleSrc from "../../assets/icons/check-circle.svg";
import clockPendingSrc from "../../assets/icons/clock-pending.svg";
import arrowUpCircleSrc from "../../assets/icons/arrow-up-circle.svg";
import arrowDownCircleSrc from "../../assets/icons/arrow-down-circle.svg";
import exchangeSrc from "../../assets/icons/exchange.svg";

/**
 * ActivityIcon — 40 × 40 tonal tile that leads every transaction row.
 * spec: docs/frontend/ui-components.md#activityicon
 */

export type ActivityIconVariant =
  | "check-circle"
  | "clock-pending"
  | "arrow-up-circle"
  | "arrow-down-circle"
  | "exchange";

/** Tonal variant — controls tile fill and glyph colour. */
export type ActivityIconTone = "success" | "warning" | "neutral";

export interface ActivityIconProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which icon to display. */
  icon: ActivityIconVariant;
  /** Tile background and glyph colour. @default "neutral" */
  tone?: ActivityIconTone;
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

const TILE_BASE_CLASSES = [
  "inline-flex items-center justify-center",
  "size-10 shrink-0",
  "rounded-[var(--radius-pipeline-card)]",
].join(" ");

const TILE_CLASSES_BY_TONE: Record<ActivityIconTone, string> = {
  success: `${TILE_BASE_CLASSES} bg-[var(--color-pipeline-success)]`,
  warning: `${TILE_BASE_CLASSES} bg-[var(--color-pipeline-warning)]`,
  neutral: `${TILE_BASE_CLASSES} bg-[var(--color-pipeline-fill-muted)]`,
};

const GLYPH_FILTER_BY_TONE: Record<ActivityIconTone, string> = {
  success: "brightness(0) invert(1)",
  warning: "brightness(0) invert(1)",
  neutral: "brightness(0)",
};

export const ActivityIcon = React.forwardRef<HTMLDivElement, ActivityIconProps>(
  function ActivityIcon(
    {
      icon,
      tone = "neutral",
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

    const tileClasses = TILE_CLASSES_BY_TONE[tone];
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
        {/* 20 px icon, coloured via CSS filter based on tone */}
        <img
          src={src}
          alt={ariaLabel ?? defaultLabel}
          width={20}
          height={20}
          aria-hidden="true"
          style={{ filter: GLYPH_FILTER_BY_TONE[tone] }}
        />
      </div>
    );
  },
);

ActivityIcon.displayName = "ActivityIcon";

export default ActivityIcon;

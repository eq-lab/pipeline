import React from "react";
import { HeroIcon } from "../HeroIcon/HeroIcon";

/**
 * StakeHeader — centered header displayed above the stake card.
 * spec: docs/frontend/ui-components.md#stakeheader
 */

export interface StakeHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Heading text rendered below the HeroIcon.
   * Defaults to `"Earn 8.42% p.a."`.
   */
  title?: string;
}

const rootClasses = ["flex flex-col items-center", "gap-3"].join(" ");

const headingClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "text-center",
  "select-none",
].join(" ");

export const StakeHeader = React.forwardRef<HTMLDivElement, StakeHeaderProps>(
  function StakeHeader({ title = "Earn 8.42% p.a.", className, ...rest }, ref) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        <HeroIcon icon="chart" aria-hidden="true" />

        <h2 data-testid="stake-header-title" className={headingClasses}>
          {title}
        </h2>
      </div>
    );
  },
);

StakeHeader.displayName = "StakeHeader";

export default StakeHeader;

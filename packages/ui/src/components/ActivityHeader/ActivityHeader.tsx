import React from "react";
import { HeroIcon } from "../HeroIcon/HeroIcon";

/**
 * ActivityHeader — responsive header above the Activity page transaction list.
 * spec: docs/frontend/ui-components.md#activityheader
 */

export interface ActivityHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Heading text rendered below the HeroIcon. Defaults to `"Activity"`. */
  title?: string;
}

const rootClasses = [
  "flex flex-col items-start md:items-center",
  "w-full",
  "gap-3",
].join(" ");

const headingClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink)]",
  "text-left md:text-center",
  "select-none",
].join(" ");

export const ActivityHeader = React.forwardRef<
  HTMLDivElement,
  ActivityHeaderProps
>(function ActivityHeader({ title = "Activity", className, ...rest }, ref) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={composed} {...rest}>
      {/* Wrapper owns the `hidden md:block` toggle — HeroIcon's own `inline-flex`
          utility would beat `hidden` on the icon itself (CSS precedence, Issue #547). */}
      <div className="hidden md:block">
        <HeroIcon icon="arrow-clock" aria-hidden="true" />
      </div>

      <h2
        data-testid="transactions-activity-header-title"
        className={headingClasses}
      >
        {title}
      </h2>
    </div>
  );
});

ActivityHeader.displayName = "ActivityHeader";

export default ActivityHeader;

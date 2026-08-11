import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";

/**
 * DepositHeader — responsive header above the deposit / conversion card.
 * spec: docs/frontend/ui-components.md#depositheader
 */

export interface DepositHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Heading text rendered below the coin icon. Defaults to `"1:1 Conversion"`. */
  title?: string;
}

const rootClasses = [
  "flex flex-col items-start md:items-center",
  "w-full",
  "gap-3",
  "mb-8",
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

export const DepositHeader = React.forwardRef<
  HTMLDivElement,
  DepositHeaderProps
>(function DepositHeader(
  { title = "1:1 Conversion", className, ...rest },
  ref,
) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={composed} {...rest}>
      <CoinIcon
        token="plusd"
        size="xl"
        aria-hidden="true"
        className="hidden md:block"
      />

      <h2 className={headingClasses}>{title}</h2>
    </div>
  );
});

DepositHeader.displayName = "DepositHeader";

export default DepositHeader;

import React from "react";

/**
 * AmountPill — static, non-interactive ink-filled amount pill (use Button for clickables).
 * spec: docs/frontend/ui-components.md#amountpill
 */

export interface AmountPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The amount text to display inside the pill, e.g. `"+500.00 USDC"`. */
  children: React.ReactNode;
}

const pillClasses = [
  "inline-flex items-center justify-center",
  "px-3 py-1",
  "rounded-full",
  "bg-[var(--color-pipeline-ink)]",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-emphasized)]",
  "text-[color:var(--color-pipeline-on-dark)]",
  "whitespace-nowrap select-none",
].join(" ");

export const AmountPill = React.forwardRef<HTMLSpanElement, AmountPillProps>(
  function AmountPill({ children, className, ...rest }, ref) {
    const composed = [pillClasses, className].filter(Boolean).join(" ");

    return (
      <span ref={ref} className={composed} {...rest}>
        {children}
      </span>
    );
  },
);

AmountPill.displayName = "AmountPill";

export default AmountPill;

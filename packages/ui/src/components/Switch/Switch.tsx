/**
 * Switch — library toggle control (52×24 track, 32×20 lozenge knob; LP review
 * #12 / #1158, Figma switcher inside node 6111:1371).
 * spec: docs/frontend/ui-components.md#switch
 */

import React from "react";

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> {
  checked: boolean;
  onChange: (next: boolean) => void;
}

const trackClasses = [
  "inline-flex items-center shrink-0",
  "h-6 w-13",
  "rounded-full p-[2px]",
  "border-none cursor-pointer",
  "transition-colors duration-150 ease-out",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--color-pipeline-ink)]",
].join(" ");

const knobClasses = [
  "block h-5 w-8",
  "rounded-full",
  "bg-white",
  "transition-transform duration-150 ease-out",
].join(" ");

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch({ checked, onChange, className, ...rest }, ref) {
    const composed = [
      trackClasses,
      checked
        ? "bg-[var(--color-pipeline-positive-primary)]"
        : "bg-[var(--color-pipeline-line)]",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={composed}
        {...rest}
      >
        <span
          aria-hidden="true"
          className={[
            knobClasses,
            checked ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
        />
      </button>
    );
  },
);

Switch.displayName = "Switch";

export default Switch;

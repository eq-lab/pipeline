import React from "react";

/**
 * IconButton — 40×40 top-bar navigation icon button with optional tooltip.
 * spec: docs/frontend/ui-components.md#iconbutton
 */

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> {
  /** 24 × 24 icon node. Prefer SVG that paints with `currentColor`. */
  icon: React.ReactNode;
  /** Accessible label — applied as `aria-label` on the underlying `<button>`. */
  label: string;
  /** Whether the icon represents the active navigation target. */
  active?: boolean;
  /** Render the hover/focus-visible tooltip below the button. Default `true`. */
  showTooltip?: boolean;
}

const baseClasses = [
  "group",
  "relative",
  "inline-flex items-center justify-center",
  "size-10 px-2",
  "rounded-[var(--radius-pipeline-button)]",
  "cursor-pointer select-none",
  "bg-transparent",
  "transition-[background-color,color,box-shadow,opacity] duration-150 ease-out",
  "hover:bg-[color-mix(in_oklab,var(--color-pipeline-ink)_8%,transparent)]",
  "active:bg-[color-mix(in_oklab,var(--color-pipeline-ink)_14%,transparent)]",
  "focus:outline-none",
  "focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-offset-2",
  "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
  "focus-visible:ring-[var(--color-pipeline-brand)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

const tooltipClasses = [
  // Positioning
  "pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 z-10",
  // Visibility
  "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150",
  // Box
  "inline-flex items-center justify-center",
  "px-1 py-1 min-w-12 max-w-60",
  "rounded-[var(--radius-pipeline-button)]",
  "bg-[var(--color-pipeline-ink)]",
  "text-[color:var(--color-pipeline-on-dark)]",
  // Type
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-[family-name:var(--font-body)]",
  "whitespace-nowrap",
].join(" ");

const stateClasses = {
  active: "text-[color:var(--color-pipeline-brand)]",
  inactive: "text-[color:var(--color-pipeline-ink-muted)]",
} as const;

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon,
      label,
      active = false,
      showTooltip = true,
      className,
      type,
      ...rest
    },
    ref,
  ) {
    const composed = [
      baseClasses,
      active ? stateClasses.active : stateClasses.inactive,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        aria-label={label}
        aria-pressed={active || undefined}
        data-active={active ? "true" : "false"}
        className={composed}
        {...rest}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-6 items-center justify-center"
        >
          {icon}
        </span>

        {/* aria-hidden — the label is already announced via aria-label above. */}
        {showTooltip && label ? (
          <span aria-hidden="true" className={tooltipClasses}>
            {label}
          </span>
        ) : null}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";

export default IconButton;

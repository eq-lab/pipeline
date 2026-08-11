import React from "react";

/**
 * SegmentedTabs — presentational segmented-control / filter bar.
 * spec: docs/frontend/ui-components.md#segmentedtabs
 */

export interface SegmentedTabsTab {
  id: string;
  label: string;
}

export interface SegmentedTabsProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onSelect"
> {
  /** Ordered list of tabs to render. */
  tabs: SegmentedTabsTab[];
  /** The `id` of the currently active tab. */
  activeId: string;
  /** Called when the user clicks an inactive tab. */
  onSelect?: (id: string) => void;
  /** Additional class names forwarded to the container element. */
  className?: string;
  /** Visual variant: `"track"` (default, gray track) or `"floating"` (trackless pill). */
  variant?: "track" | "floating";
}

export const SegmentedTabs = React.forwardRef<
  HTMLDivElement,
  SegmentedTabsProps
>(function SegmentedTabs(
  { tabs, activeId, onSelect, className, variant = "track", ...rest },
  ref,
) {
  const isFloating = variant === "floating";

  const containerClasses = isFloating
    ? [
        // No outer track — transparent container, compact inline group
        "flex items-center gap-0.5",
        className,
      ]
        .filter(Boolean)
        .join(" ")
    : [
        // Pill container (track variant)
        "flex items-center",
        "p-0.5",
        "rounded-[6px]",
        "bg-[var(--color-pipeline-fill-muted)]",
        "w-full",
        className,
      ]
        .filter(Boolean)
        .join(" ");

  return (
    <div ref={ref} role="tablist" className={containerClasses} {...rest}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;

        const tabClasses = isFloating
          ? [
              // Intrinsic width (no flex-1)
              "flex items-center justify-center",
              "h-7",
              "px-2",
              "rounded-[var(--radius-pipeline-button)]",
              // Background
              isActive
                ? "bg-[var(--color-pipeline-surface)] shadow-sm"
                : "bg-transparent",
              // Typography
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              isActive
                ? "font-[var(--font-weight-medium)]"
                : "font-[var(--font-weight-regular)]",
              // Colour
              isActive
                ? "text-[color:var(--color-pipeline-ink)]"
                : "text-[color:var(--color-pipeline-ink-muted)]",
              // Interaction
              "cursor-pointer select-none whitespace-nowrap",
              "transition-[background-color,color,box-shadow] duration-150 ease-out",
              // Focus-visible ring
              "focus:outline-none focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-offset-2",
              "focus-visible:ring-[var(--color-pipeline-brand)]",
              "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
            ]
              .filter(Boolean)
              .join(" ")
          : [
              // Equal-width tabs (track variant)
              "flex-1",
              // Layout
              "flex items-center justify-center",
              "h-8",
              "px-1.5",
              "rounded-[var(--radius-pipeline-button)]",
              // Background
              isActive
                ? "bg-[var(--color-pipeline-surface)]"
                : "bg-transparent",
              // Typography
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-medium)]",
              // Colour
              isActive
                ? "text-[color:var(--color-pipeline-ink)]"
                : "text-[color:var(--color-pipeline-ink-muted)]",
              // Interaction
              "cursor-pointer select-none whitespace-nowrap",
              "transition-[background-color,color,box-shadow] duration-150 ease-out",
              // Focus-visible ring — only on focusable element
              "focus:outline-none focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-offset-2",
              "focus-visible:ring-[var(--color-pipeline-brand)]",
              "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
            ]
              .filter(Boolean)
              .join(" ");

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-testid={`tab-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={tabClasses}
            onClick={() => {
              if (!isActive) {
                onSelect?.(tab.id);
              }
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
});

SegmentedTabs.displayName = "SegmentedTabs";

export default SegmentedTabs;

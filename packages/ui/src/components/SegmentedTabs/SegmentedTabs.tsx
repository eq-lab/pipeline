import React from "react";

/**
 * SegmentedTabs — Pipeline UI primitive.
 *
 * A purely presentational segmented-control / filter bar. The owning page
 * manages active state; this component is visual-only.
 *
 * Anatomy (Figma node 1497-94917):
 *   - Container pill: muted-fill background (`--color-pipeline-fill-muted`),
 *     2 px padding, radius-xl (6 px). Same fill token as HeroIcon.
 *   - Active tab: paper-white background (`--color-pipeline-surface`),
 *     radius-s (4 px), primary ink label.
 *   - Inactive tabs: transparent background, secondary-ink label.
 *   - All tabs equal-width (`flex-1`), 32 px tall, caption-emphasized type
 *     style (Graphik LC Medium 12/16).
 *
 * Design tokens:
 *   - `--color-pipeline-fill-muted`   — container background
 *   - `--color-pipeline-surface`      — active tab background
 *   - `--color-pipeline-ink`          — active tab label colour
 *   - `--color-pipeline-ink-muted`    — inactive tab label colour
 *   - `--font-body`                   — Graphik LC family
 *   - `--text-pipeline-caption`       — 12 px font size
 *   - `--text-pipeline-caption--line-height` — 16 px line height
 *   - `--font-weight-medium`          — weight 500 (Caption Emphasized)
 */

export interface SegmentedTabsTab {
  id: string;
  label: string;
}

export interface SegmentedTabsProps {
  /** Ordered list of tabs to render. */
  tabs: SegmentedTabsTab[];
  /** The `id` of the currently active tab. */
  activeId: string;
  /** Called when the user clicks an inactive tab. */
  onSelect?: (id: string) => void;
  /** Additional class names forwarded to the container element. */
  className?: string;
}

export const SegmentedTabs = React.forwardRef<
  HTMLDivElement,
  SegmentedTabsProps
>(function SegmentedTabs({ tabs, activeId, onSelect, className }, ref) {
  const containerClasses = [
    // Pill container
    "flex items-center",
    "p-0.5", // 2 px padding around tabs
    "rounded-[6px]", // radius-xl — matches Figma var(--radius/radius-xl, 6px)
    "bg-[var(--color-pipeline-fill-muted)]",
    "w-full",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={ref} role="tablist" className={containerClasses}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const tabClasses = [
          // Equal-width tabs
          "flex-1",
          // Layout
          "flex items-center justify-center",
          "h-8", // 32 px
          "px-1.5", // 6 px horizontal padding (Figma size-6)
          "rounded-[var(--radius-pipeline-button)]", // 4 px radius-s
          // Background
          isActive ? "bg-[var(--color-pipeline-surface)]" : "bg-transparent",
          // Typography — Caption Emphasized: Graphik LC Medium 12/16
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

import React from "react";

/**
 * IconButton — Pipeline UI primitive.
 *
 * 40 × 40 square button used for the four navigation icons in the top bar
 * (Figma frame 1497-94556 → nodes 1497:94719/94720/94721/94722). The button
 * renders the supplied `icon` (a 24 × 24 ReactNode — typically an `<img>`,
 * `<svg>`, or imported icon component) centered inside a transparent slot and
 * uses an accessible `aria-label` derived from `label`.
 *
 * Visual states:
 *   - `active`   — icon coloured with `--color-pipeline-brand` (navy/cobalt).
 *   - inactive   — icon coloured with `--color-pipeline-ink-muted` (neutral grey).
 *
 * The icon itself is coloured via `color` on the button so SVGs using
 * `currentColor` (the convention for our nav icons) pick up the active /
 * inactive state automatically. Raster `<img>` icons should be supplied
 * pre-coloured.
 *
 * Hover and focus-visible states reuse the brand ring used by the rectangular
 * `Button` variants. The hover background is a faint tint of the ink colour so
 * the affordance is visible against both light card and paper backgrounds.
 *
 * Tooltip:
 *   When `showTooltip` is `true` (default) and `label` is non-empty, a small
 *   dark caption tooltip fades in below the button on `:hover` and
 *   `:focus-visible`. The tooltip is `aria-hidden="true"` — screen-reader
 *   users already receive the label via `aria-label` and must not hear it
 *   announced twice. Set `showTooltip={false}` to opt out for future
 *   consumers that supply their own tooltip layer.
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
  /**
   * Whether to render the hover/focus-visible tooltip below the button.
   * Defaults to `true`. Set to `false` to opt out for consumers that supply
   * their own tooltip layer or where a tooltip would be distracting.
   */
  showTooltip?: boolean;
}

// Shared chrome. The IconButton is intentionally borderless and transparent —
// hover, focus-visible, and active states layer on top of the resting state.
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

// Tooltip element rendered below the button on hover / focus-visible.
const tooltipClasses = [
  // Positioning — centred below the button, ~8 px gap (mt-2 = 8px)
  "pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 z-10",
  // Visibility — hidden by default, fade in on group hover / focus-visible
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
    { icon, label, active = false, showTooltip = true, className, type, ...rest },
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
        {/* Fixed 24px slot — mirrors the Figma icon container so layout is
            stable regardless of which icon is supplied. */}
        <span
          aria-hidden="true"
          className="inline-flex size-6 items-center justify-center"
        >
          {icon}
        </span>

        {/* Decorative tooltip — screen-reader users already receive the label
            via aria-label above; aria-hidden prevents double announcement. */}
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

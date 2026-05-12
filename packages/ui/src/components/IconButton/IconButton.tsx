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
}

// Shared chrome. The IconButton is intentionally borderless and transparent —
// hover, focus-visible, and active states layer on top of the resting state.
const baseClasses = [
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

const stateClasses = {
  active: "text-[color:var(--color-pipeline-brand)]",
  inactive: "text-[color:var(--color-pipeline-ink-muted)]",
} as const;

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, label, active = false, className, type, ...rest },
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
      </button>
    );
  },
);

IconButton.displayName = "IconButton";

export default IconButton;

import React from "react";

/**
 * EmptyState — Pipeline UI "no data yet" primitive.
 *
 * Generic centred placeholder used inside a parent container (Card, panel,
 * section body) when a list or surface has nothing to show yet. The dashboard's
 * Recent activity card is the canonical example (Figma frame 1497-94556 →
 * node 1497:94569 `Placeholder`, with the caption "You will see all
 * transactions here").
 *
 * Layout mirrors the Figma `Placeholder` frame:
 *   - Two-row vertical stack, centred horizontally and vertically inside the
 *     parent container (the parent gives the EmptyState its height; we
 *     stretch to fill via `h-full` so the block centres on the available
 *     space, mirroring `flex-[1_0_0] items-center justify-center` from the
 *     Figma node).
 *   - `illustration` slot — usually a 240×240 SVG (e.g.
 *     `ActivityEmptyIllustration` from Issue #202). EmptyState does not
 *     constrain the slot's size so the
 *     illustration owns its own dimensions; the slot is rendered above the
 *     caption with no enforced gap (matches Figma which lets the
 *     illustration's intrinsic height drive the spacing).
 *   - `caption` slot — body-size muted ink, centred. Accepts a ReactNode so
 *     callers can compose multi-line strings (the Recent activity copy in
 *     Figma is rendered as two `<p>` lines).
 *
 * Pure composition primitive — no surface fill, border, padding, or radius.
 * The parent (typically `Card`) supplies the chrome. All visual values come
 * from the design tokens declared in `@pipeline/ui/styles/theme.css`.
 */

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Illustration rendered above the caption. Pass a sized illustration
   * primitive from `@pipeline/ui` (e.g. the 240×240
   * `ActivityEmptyIllustration` used by the Recent activity empty state).
   * Optional so callers can render a caption-only empty state when no
   * illustration is appropriate.
   */
  illustration?: React.ReactNode;
  /**
   * Muted caption rendered below the illustration. ReactNode so callers can
   * supply multi-line copy or inline emphasis. Required because every empty
   * state in the Figma frame carries a caption.
   */
  caption: React.ReactNode;
}

// Outer stack — full width / height of the parent, centred on both axes.
// Mirrors Figma node 1497:94569 (`flex-[1_0_0] items-center justify-center`).
const rootClasses = [
  "flex flex-col items-center justify-center",
  "h-full w-full",
  "text-center",
  "font-[family-name:var(--font-body)]",
].join(" ");

// Caption row — body size, muted ink, centred. Matches Figma node 1497:94665
// (Figma tokens "font/line-height/body" 22px and "content-test/secondary").
// NB: don't write Tailwind class syntax in comments — the v4 scanner picks it
// up and emits invalid CSS for slash-containing var() names.
const captionClasses = [
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState({ illustration, caption, className, ...rest }, ref) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        {illustration ? (
          <div aria-hidden="true" className="shrink-0">
            {illustration}
          </div>
        ) : null}
        <div className={captionClasses}>{caption}</div>
      </div>
    );
  },
);

EmptyState.displayName = "EmptyState";

export default EmptyState;

import React from "react";

/**
 * LinkCard — Pipeline UI primitive.
 *
 * Row used in the QUESTIONS & ANSWERS section (Figma frame 1497-94556, nodes
 * 1497:94669 / 1497:94671 / 1497:94673). A label on the left and an
 * arrow-up-right icon on the right; the whole row is a focusable anchor.
 *
 * Visual structure:
 *   - Top border hairline (`--color-pipeline-line`) separating rows.
 *   - Label text in Body style (`--text-pipeline-body`), muted ink color in
 *     resting state, full ink on hover/focus.
 *   - Arrow-up-right icon (12.5 × 12.5 SVG, `currentColor`) on the right;
 *     tracks the text colour so it brightens with the label.
 *   - Minimum row height 40px, vertical padding 8–9px (mirrors Figma).
 *
 * Focus ring mirrors the pattern used by `Button` and `IconButton`.
 */

export interface LinkCardProps extends Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "children"
> {
  /** Visible label text — e.g. "How it works?" */
  label: string;
}

const rootClasses = [
  // Layout
  "flex items-center justify-between gap-3",
  "w-full min-h-10 py-2",
  "border-t border-solid border-[color:var(--color-pipeline-line)]",
  // Typography
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-regular)]",
  // Resting colour — muted ink; transitions to full ink on hover/focus
  "text-[color:var(--color-pipeline-ink-muted)]",
  // Interaction
  "cursor-pointer select-none no-underline",
  "transition-colors duration-150 ease-out",
  "hover:text-[color:var(--color-pipeline-ink)]",
  // Focus ring
  "focus:outline-none",
  "focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-offset-2",
  "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
  "focus-visible:ring-[var(--color-pipeline-brand)]",
  "focus-visible:text-[color:var(--color-pipeline-ink)]",
].join(" ");

/** Inline arrow-up-right SVG — 12.5 × 12.5, painted with `currentColor`. */
function ArrowUpRight() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 12.4999 12.4999"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={12.5}
      height={12.5}
    >
      <path
        d="M12.4999 10.75C12.4999 11.1642 12.1642 11.5 11.7499 11.5C11.3357 11.5 10.9999 11.1642 10.9999 10.75V2.56055L1.28022 12.2803C0.987324 12.5732 0.512563 12.5732 0.21967 12.2803C-0.0732233 11.9874 -0.0732233 11.5126 0.21967 11.2197L9.9394 1.5H1.74994C1.33573 1.5 0.999943 1.16421 0.999943 0.75C0.999943 0.335786 1.33573 0 1.74994 0H11.7499C12.1642 0 12.4999 0.335786 12.4999 0.75V10.75Z"
        fill="currentColor"
      />
    </svg>
  );
}

export const LinkCard = React.forwardRef<HTMLAnchorElement, LinkCardProps>(
  function LinkCard({ label, className, ...rest }, ref) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");

    return (
      <a ref={ref} className={composed} {...rest}>
        {/* Label — occupies the left portion of the row */}
        <span className="inline-block overflow-hidden text-ellipsis whitespace-nowrap">
          {label}
        </span>

        {/* Icon slot — fixed 24px container mirrors the Figma drill-in node
            (.drill-in, 1497:94670;8902:3678) so the icon is optically centered
            inside a consistent touch target. */}
        <span
          aria-hidden="true"
          className="inline-flex size-6 shrink-0 items-center justify-center"
        >
          <ArrowUpRight />
        </span>
      </a>
    );
  },
);

LinkCard.displayName = "LinkCard";

export default LinkCard;

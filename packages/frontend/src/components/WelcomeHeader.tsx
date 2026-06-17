import React from "react";
import { HomeStatsStrip } from "./HomeStatsStrip";

/**
 * WelcomeHeader — Dashboard top heading with stats strip.
 *
 * Implements Figma frame 1497:94558 ("Title" row inside "Heading"):
 *   - Left: large "Welcome" display heading in Besley serif, ink-subtle colour.
 *   - Right: stats strip with three Stat readouts separated by hairline
 *     left-borders, plus a trailing external-link icon button.
 *
 * Responsive behaviour:
 *   - Desktop (md+): heading at 64px, stats strip visible on the right.
 *     Always renders "Welcome" (disconnected desktop out of scope for #466).
 *   - Mobile (below md): heading at 32px, stats strip hidden here — the
 *     same stats are rendered at the bottom of the home page via
 *     `HomeStatsStrip` in `routes/index.tsx` (Figma mobile frame 1989:8292).
 *     When `isConnected` is `true`, renders "Welcome back" (Figma all three
 *     connected frames: 1988:7074, 1984:6501, 1886:46777).
 *
 * The `isConnected` prop is **mobile-only**. On desktop the heading always
 * reads "Welcome" because the connected desktop balance states are out of
 * scope for issue #466. The Tailwind responsive utilities (`md:`) gate the
 * copy change to viewports below 768px.
 *
 * The exchange rate and APY stats are live — sourced from `HomeStatsStrip`
 * which delegates to `useStakedPlusdConvertToAssets` and `useStats`.
 * TVL remains hardcoded (separate issue).
 * All visual values come from design tokens in `@pipeline/ui/styles/theme.css`.
 */

export interface WelcomeHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * When `true` the mobile heading reads "Welcome back" instead of "Welcome".
   * Has no effect at `md` and above — the desktop heading always reads "Welcome".
   * Defaults to `false` (disconnected).
   */
  isConnected?: boolean;
}

// Outer row: heading left, stats strip right, aligned to the bottom edge
// (items-end mirrors Figma's "end" alignment on node 1497:94558).
const rootClasses = [
  "flex w-full gap-12 items-end justify-center",
  "px-0",
].join(" ");

// "Welcome" heading — display-serif.
// Mobile: 32px / 36px (Figma mobile frame 1989:8292 value).
// Desktop (md+): 64px / 64px (Figma desktop frame 1497:94558).
const headingClasses = [
  "flex-1 min-w-0",
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[32px] leading-[36px]",
  "md:text-[length:var(--text-pipeline-title)] md:leading-[var(--text-pipeline-title--line-height)]",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "whitespace-nowrap",
].join(" ");

export function WelcomeHeader({
  className,
  isConnected = false,
  ...rest
}: WelcomeHeaderProps) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  return (
    <div className={composed} {...rest}>
      {/* Left: display heading.
          Mobile: "Welcome back" when connected, "Welcome" otherwise.
          Desktop (md+): always "Welcome" (connected desktop states out of
          scope for issue #466 — only the mobile greeting changes). */}
      <h1 className={headingClasses} data-testid="home-welcome-heading">
        {/* Mobile-only connected greeting — hidden at md+ via sr-only wrapper.
            We render both variants and show/hide with Tailwind so the DOM
            diff is purely class-driven and screen readers pick up the right
            string at each breakpoint. */}
        <span className="md:hidden">
          {isConnected ? "Welcome back" : "Welcome"}
        </span>
        <span className="hidden md:inline">Welcome</span>
      </h1>

      {/* Right: stats strip — desktop only (hidden below md breakpoint).
          On mobile the same stats strip is rendered at the bottom of the
          home page via HomeStatsStrip in routes/index.tsx. */}
      <HomeStatsStrip className="hidden md:flex" />
    </div>
  );
}

export default WelcomeHeader;

import React from "react";
import { Button, IconButton, Logo } from "@pipeline/ui";
import navHomeIcon from "@pipeline/ui/assets/icons/nav-home.svg";
import navDollarIcon from "@pipeline/ui/assets/icons/nav-dollar.svg";
import navStatsIcon from "@pipeline/ui/assets/icons/nav-stats.svg";
import navHistoryIcon from "@pipeline/ui/assets/icons/nav-history.svg";

/**
 * TopBar — global page header.
 *
 * Composite header matching Figma frame `1497:94715` (the top bar of the
 * "Disconnected" home view, frame `1497:94556`):
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │  Pipeline       [Home] [$] [Stats] [History]    [Connect Wallet]  │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * Layout:
 *   - The bar is a flex row, justified between three slots: a fixed-width
 *     logo slot on the left (160px), an expanding navigation slot in the
 *     middle, and a fixed-width button slot on the right (160px). The
 *     `justify-between` strategy preserves the centred feel of the nav while
 *     keeping the logo flush-left and the CTA flush-right at all widths.
 *   - Vertical padding: `16px` (`var(--size-16,16px)` in Figma). Horizontal
 *     padding: `16px` to match the design.
 *   - Background: `--color-pipeline-paper` (page bg). Bottom border:
 *     `--color-pipeline-line` (1px, solid). No hardcoded colors.
 *
 * Composition:
 *   - {@link Logo} for the brand wordmark on the left.
 *   - Four {@link IconButton} instances for the nav slots, in Figma order:
 *     Home (active), Convert, Markets, History. The active flag is wired
 *     through to the `active` prop so the icon paints with the brand
 *     navy token; the rest stay muted.
 *   - One {@link Button} (variant `primary-dark`) labelled "Connect Wallet"
 *     on the right, matching node `1497:94725`.
 *
 * Icon handling:
 *   - The four nav SVGs live in `@pipeline/ui/assets/icons/`. Vite resolves
 *     them as URL imports. To inherit the IconButton `currentColor`-driven
 *     active/inactive state, each icon is rendered as a CSS mask (the SVG
 *     becomes the alpha mask of a `currentColor` block) — the same approach
 *     used in `IconButton.stories.tsx`. This keeps the active state purely
 *     token-driven, with no per-icon recolouring required.
 *
 * Responsive notes:
 *   - At the design's 1728px width the bar lays out with comfortable spacing
 *     in the centre slot. At common laptop widths (1280–1440) the nav still
 *     fits without crowding because the icon row uses `gap-8` (32px) and
 *     each icon is only 40px wide. At narrower widths the centre slot can
 *     wrap or shrink — the IconButton already has `shrink-0`, so the only
 *     thing that gives is the gap. We deliberately do not introduce a
 *     mobile-collapsed variant here; the Issue scope is desktop.
 *
 * Accessibility:
 *   - The bar is rendered as a `<header>` with `role="banner"` (implicit
 *     for `<header>` at the document root) and a `<nav aria-label="Primary">`
 *     wrapper around the icon row. Each IconButton supplies its own
 *     `aria-label` via the `label` prop.
 *   - The Connect Wallet button is a real `<button type="button">` with
 *     focus-visible styles inherited from the {@link Button} primitive.
 */

/** Internal: render a nav SVG as a `currentColor`-driven mask so the
 * surrounding IconButton's active/inactive colour wins. */
function MaskIcon({ src, title }: { src: string; title: string }) {
  return (
    <span
      role="img"
      aria-label={title}
      style={{
        display: "inline-block",
        width: 24,
        height: 24,
        backgroundColor: "currentColor",
        WebkitMask: `url(${src}) center / contain no-repeat`,
        mask: `url(${src}) center / contain no-repeat`,
      }}
    />
  );
}

/** One nav slot: icon + accessible label + active flag. */
interface NavItem {
  key: string;
  label: string;
  src: string;
  active?: boolean;
}

// Figma order, node ids on the side for traceability.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { key: "home", label: "Home", src: navHomeIcon, active: true }, // 1497:94719
  { key: "convert", label: "Convert", src: navDollarIcon }, //         1497:94720
  { key: "markets", label: "Markets", src: navStatsIcon }, //          1497:94721
  { key: "history", label: "History", src: navHistoryIcon }, //        1497:94722
];

export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {
  /** Optional click handler for the Connect Wallet CTA. */
  onConnectWallet?: () => void;
  /** Active nav key — defaults to the Figma-marked "home" slot. */
  activeNav?: NavItem["key"];
}

export const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  function TopBar(
    { onConnectWallet, activeNav = "home", className, ...rest },
    ref,
  ) {
    const composed = [
      // Layout: flex row, three slots, justified between, vertically centred.
      "flex items-center justify-between",
      // Padding mirrors Figma `p-16` (16px all sides).
      "p-4",
      "w-full",
      // Surface tokens — no hardcoded colors.
      "bg-[var(--color-pipeline-paper)]",
      "border-b border-[var(--color-pipeline-line)]",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <header
        ref={ref}
        className={composed}
        {...rest}
        data-node-id="1497:94715"
      >
        {/* Left slot — fixed 160px wide so the centred nav reads symmetrically.
          The Logo intrinsic width (116px) plus the slot's flex container
          mirrors Figma node 1497:94716. */}
        <div
          className="flex w-40 shrink-0 items-center"
          data-node-id="1497:94716"
        >
          <Logo />
        </div>

        {/* Middle slot — primary navigation. `flex-1` lets it absorb the
          remaining space; `justify-center` keeps the icon row centred. */}
        <nav
          aria-label="Primary"
          className="flex min-w-0 flex-1 items-center justify-center gap-8"
          data-node-id="1497:94718"
        >
          {NAV_ITEMS.map((item) => (
            <IconButton
              key={item.key}
              label={item.label}
              active={activeNav === item.key || (!activeNav && item.active)}
              icon={<MaskIcon src={item.src} title={item.label} />}
            />
          ))}
        </nav>

        {/* Right slot — fixed 160px wide so the centre nav stays optically
          centred. Right-aligned content (`justify-end`) keeps the CTA flush
          to the right edge of the bar. */}
        <div
          className="flex w-40 shrink-0 items-center justify-end"
          data-node-id="1497:94724"
        >
          <Button
            variant="primary-dark"
            onClick={onConnectWallet}
            data-node-id="1497:94725"
          >
            Connect Wallet
          </Button>
        </div>
      </header>
    );
  },
);

TopBar.displayName = "TopBar";

export default TopBar;

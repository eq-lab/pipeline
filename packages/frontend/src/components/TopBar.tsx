import React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Button, IconButton, Logo, NavIcon, WalletPill } from "@pipeline/ui";

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
 *   - Right slot: when the `wallet` prop is absent, one {@link Button}
 *     (variant `primary-dark`) labelled "Connect Wallet" (node `1497:94725`);
 *     when `wallet` is present, a {@link WalletPill} (node `1498:100168`)
 *     shows the connected balance instead.
 *
 * Icon handling:
 *   - Each nav slot uses {@link NavIcon} from `@pipeline/ui`, which renders
 *     the icon as an inline SVG with `fill="currentColor"`. This means the
 *     icon colour is inherited directly from the surrounding CSS `color`
 *     property set by IconButton's active/inactive class, with no URL import
 *     or CSS mask needed.
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

/** One nav slot: icon + accessible label + optional route target. */
interface NavItem {
  key: "home" | "deposit" | "stats" | "history";
  label: string;
  /** TanStack Router path this slot navigates to; omit for slots with no route yet. */
  to?: string;
}

// Figma order, node ids on the side for traceability.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { key: "home", label: "Home", to: "/" }, // 1497:94719
  { key: "deposit", label: "Deposit", to: "/deposit" }, // 1497:94720
  { key: "stats", label: "Stats" }, //               1497:94721
  { key: "history", label: "History", to: "/transactions" }, // 1497:94722
];

export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {
  /** Optional click handler for the Connect Wallet CTA. */
  onConnectWallet?: () => void;
  /**
   * Active nav key — when omitted the active slot is derived from the current
   * URL.  Accepts the canonical key names: `"home" | "deposit" | "stats" |
   * "history"`.
   */
  activeNav?: "home" | "deposit" | "stats" | "history";
  /**
   * When present, the top-bar renders a `WalletPill` on the right instead of
   * the "Connect Wallet" button, signalling the connected state.
   *
   * @example
   * ```tsx
   * <TopBar wallet={{ balance: "$10,000.00" }} />
   * ```
   */
  wallet?: { balance: string };
}

export const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  function TopBar(
    { onConnectWallet, activeNav, wallet, className, ...rest },
    ref,
  ) {
    const navigate = useNavigate();
    const pathname = useRouterState({ select: (s) => s.location.pathname });

    // Derive active key from the current URL, then fall back to "home".
    // /withdraw shares the dollar icon with /deposit — no separate nav entry.
    const derivedActive: string =
      pathname === "/deposit" || pathname === "/withdraw"
        ? "deposit"
        : pathname === "/transactions"
          ? "history"
          : pathname === "/"
            ? "home"
            : "home";

    // Explicit prop wins; otherwise use the URL-derived value.
    const effectiveActive = activeNav ?? derivedActive;

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
              active={effectiveActive === item.key}
              icon={<NavIcon name={item.key} />}
              onClick={
                item.to
                  ? () => void navigate({ to: item.to as string })
                  : undefined
              }
            />
          ))}
        </nav>

        {/* Right slot — fixed 160px wide so the centre nav stays optically
          centred. Right-aligned content (`justify-end`) keeps the CTA flush
          to the right edge of the bar.
          When `wallet` is provided the pill replaces the Connect Wallet CTA,
          matching Figma node 1498:100168 (connected header state). */}
        <div
          className="flex w-40 shrink-0 items-center justify-end"
          data-node-id="1497:94724"
        >
          {wallet ? (
            <WalletPill
              token="usdc"
              balance={wallet.balance}
              data-node-id="1498:100168"
            />
          ) : (
            <Button
              variant="primary-dark"
              onClick={onConnectWallet}
              data-node-id="1497:94725"
            >
              Connect Wallet
            </Button>
          )}
        </div>
      </header>
    );
  },
);

TopBar.displayName = "TopBar";

export default TopBar;

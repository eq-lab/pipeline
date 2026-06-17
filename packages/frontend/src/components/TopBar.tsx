import React, { useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Button, IconButton, Logo, NavIcon, WalletPill } from "@pipeline/ui";
import {
  useEvmWallet,
  useEvmToken,
  useDepositManagerAddresses,
  useStellarWallet,
  useStellarToken,
  useWalletView,
} from "@/wallet";
import { AccountDropdown } from "./AccountDropdown";
import { ConnectWalletModal } from "./ConnectWalletModal";
import { MobileNavMenu, HamburgerGlyph } from "./MobileNavMenu";
import { useMobileNavMenu } from "./useMobileNavMenu";

/**
 * TopBar — global page header (self-contained, no external props for wallet).
 *
 * Mounted in the root layout (`__root.tsx`) so every page renders it
 * automatically.  All wallet state is read internally; no per-route prop
 * plumbing is required.
 *
 * Connected state:
 *   - Renders a `WalletPill` wrapped in a trigger button.
 *   - Clicking the pill opens the `AccountDropdown` panel (address copy,
 *     USDC balance, namespace toggle, disconnect).
 *
 * Disconnected state (neither namespace connected):
 *   - Renders a "Connect Wallet" `<Button>` that opens `ConnectWalletModal`
 *     (Issue #558 — per-wallet selection with EVM / Soroban tabs).
 *
 * Figma references:
 *   - Frame: `1497:94715` (TopBar frame)
 *   - WalletPill: `1498:100168`
 *   - Account dropdown: `1506:104728` inside `Header / Connected` (`1497:94752`)
 *
 * Active nav is derived from the current URL:
 *   - `/`                          → `"home"`
 *   - `/deposit`                   → `"deposit"` (Convert)
 *   - `/deposit?direction=withdraw`→ `"deposit"` (Convert — direction is a search param,
 *                                    pathname is still `/deposit` after the redirect)
 *   - `/stake`                     → `"stats"` (Earn)
 *   - `/transactions`              → `"history"` (Activity)
 *   - other                        → `"home"` (safe fallback)
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
  { key: "deposit", label: "Convert", to: "/deposit" }, // 1497:94720
  { key: "stats", label: "Earn", to: "/stake" }, //     1497:94721
  { key: "history", label: "Activity", to: "/transactions" }, // 1497:94722
];

export type TopBarProps = React.HTMLAttributes<HTMLElement>;

export const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  function TopBar({ className, ...rest }, ref) {
    const navigate = useNavigate();
    const pathname = useRouterState({ select: (s) => s.location.pathname });

    // ── Wallet state — all four hooks called unconditionally ──────────────
    const evm = useEvmWallet();
    const { usdc: usdcAddress } = useDepositManagerAddresses();
    const evmToken = useEvmToken({
      token:
        usdcAddress ??
        ("0x0000000000000000000000000000000000000000" as `0x${string}`),
    });
    const stellar = useStellarWallet();
    const stellarToken = useStellarToken();

    // ── View selection ────────────────────────────────────────────────────
    const { kind, setKind } = useWalletView();

    // ── Derived state ─────────────────────────────────────────────────────
    const anyConnected = evm.isConnected || stellar.isConnected;

    // Active namespace data.
    const activeAddress =
      kind === "evm"
        ? evm.isConnected
          ? evm.address
          : undefined
        : stellar.isConnected
          ? stellar.address
          : undefined;

    const activeFormattedBalance =
      kind === "evm"
        ? evmToken.formattedBalance
        : stellarToken.formattedBalance;

    const activeDisconnect =
      kind === "evm" ? evm.disconnect : stellar.disconnect;

    // Pill shows the active namespace's balance, falling back to EVM if active
    // namespace is disconnected but the other is connected.
    const pillBalance =
      activeFormattedBalance ??
      (anyConnected
        ? kind === "evm"
          ? (stellarToken.formattedBalance ?? "—")
          : (evmToken.formattedBalance ?? "—")
        : "—");

    // ── Dropdown state ────────────────────────────────────────────────────
    const [dropdownOpen, setDropdownOpen] = useState(false);

    // ── Chooser modal state ───────────────────────────────────────────────
    const [chooserOpen, setChooserOpen] = useState(false);

    // ── Mobile nav menu state ─────────────────────────────────────────────
    const mobileMenu = useMobileNavMenu();

    // ── Active nav derivation from URL ────────────────────────────────────
    const derivedActive: NavItem["key"] =
      pathname === "/deposit"
        ? "deposit"
        : pathname === "/transactions"
          ? "history"
          : pathname === "/stake"
            ? "stats"
            : pathname === "/"
              ? "home"
              : "home";

    const composed = [
      // Layout: flex row, three slots, justified between, vertically centred.
      "flex items-center justify-between",
      // Padding: 8px on mobile (Figma 1989:9052 = 56px tall = 8px + 40px + 8px),
      // restored to 16px on desktop (md and above).
      "p-2 md:p-4",
      "w-full",
      // Surface tokens — no hardcoded colors.
      "bg-[var(--color-pipeline-paper)]",
      "border-b border-[var(--color-pipeline-line)]",
      // Position context for the dropdown.
      "relative",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <header
        ref={ref}
        className={composed}
        data-testid="app-topbar"
        {...rest}
        data-node-id="1497:94715"
      >
        {/* Left slot — fixed 160px wide so the centred nav reads symmetrically.
          The Logo intrinsic width (116px) plus the slot's flex container
          mirrors Figma node 1497:94716. */}
        <div
          className="flex w-40 shrink-0 items-center"
          data-testid="topbar-logo-slot"
          data-node-id="1497:94716"
        >
          <Logo />
        </div>

        {/* Middle slot — primary navigation (desktop: md and above). */}
        <nav
          aria-label="Primary"
          className="hidden max-w-[1200px] min-w-0 flex-1 items-center gap-8 md:flex"
          data-testid="topbar-primary-nav"
          data-node-id="1497:94718"
        >
          {NAV_ITEMS.map((item) => (
            <IconButton
              key={item.key}
              label={item.label}
              active={derivedActive === item.key}
              icon={<NavIcon name={item.key} />}
              data-testid={`topbar-nav-${item.key}`}
              onClick={
                item.to
                  ? () => void navigate({ to: item.to as string })
                  : undefined
              }
            />
          ))}
        </nav>

        {/* Right slot — desktop wallet controls (md and above). */}
        <div
          className="relative hidden w-40 shrink-0 items-center justify-end md:flex"
          data-testid="topbar-wallet-slot"
          data-node-id="1497:94724"
        >
          {anyConnected ? (
            <>
              {/* Trigger button wrapping the WalletPill */}
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={dropdownOpen}
                onClick={() => setDropdownOpen((o) => !o)}
                className={[
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                  "focus-visible:outline-[var(--color-pipeline-ink)]",
                  "rounded-[var(--radius-pipeline-pill)]",
                ].join(" ")}
                data-testid="topbar-wallet-pill-trigger"
                data-node-id="1498:100168"
              >
                <WalletPill token="usdc" balance={pillBalance} />
              </button>

              {/* Account dropdown panel */}
              {dropdownOpen && (
                <AccountDropdown
                  kind={kind}
                  onKindChange={setKind}
                  address={activeAddress}
                  formattedBalance={activeFormattedBalance}
                  onConnect={kind === "evm" ? evm.connect : stellar.connect}
                  onClose={() => setDropdownOpen(false)}
                  onDisconnect={() => {
                    activeDisconnect();
                    setDropdownOpen(false);
                  }}
                />
              )}
            </>
          ) : (
            <Button
              variant="primary-dark"
              onClick={() => setChooserOpen(true)}
              data-testid="topbar-connect-button"
              data-node-id="1497:94725"
            >
              Connect Wallet
            </Button>
          )}
        </div>

        {/* Mobile right slot — hamburger button (below md). */}
        <div
          className="flex shrink-0 items-center justify-end md:hidden"
          data-testid="topbar-mobile-slot"
        >
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileMenu.isOpen}
            onClick={mobileMenu.toggle}
            className={[
              "flex size-10 items-center justify-center",
              "rounded-[var(--radius-pipeline-button)]",
              "bg-[var(--color-pipeline-surface)]",
              "text-[color:var(--color-pipeline-ink)]",
              "transition-colors hover:bg-[color-mix(in_oklab,var(--color-pipeline-ink)_8%,transparent)]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              "focus-visible:ring-[var(--color-pipeline-brand)]",
            ].join(" ")}
            data-testid="mobile-hamburger"
            data-node-id="I1989:9052;9159:21649;1989:9054"
          >
            <HamburgerGlyph />
          </button>
        </div>

        {/* Mobile nav menu panel (portal). */}
        <MobileNavMenu
          open={mobileMenu.isOpen}
          onClose={mobileMenu.close}
          pathname={pathname}
          onNavigate={(to) => void navigate({ to })}
          anyConnected={anyConnected}
          address={activeAddress}
          formattedBalance={activeFormattedBalance}
          onConnect={() => setChooserOpen(true)}
          onDisconnect={() => {
            activeDisconnect();
          }}
        />

        {/* ConnectWalletModal — shared between desktop and mobile.
            Replaces the old ConnectChooserModal with per-wallet selection. */}
        <ConnectWalletModal
          open={chooserOpen}
          onDismiss={() => setChooserOpen(false)}
        />
      </header>
    );
  },
);

TopBar.displayName = "TopBar";

export default TopBar;

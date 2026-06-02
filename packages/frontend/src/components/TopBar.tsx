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
import { ConnectChooserModal } from "./ConnectChooserModal";

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
 *   - Renders a "Connect Wallet" `<Button>` that opens `ConnectChooserModal`.
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
      // Padding mirrors Figma `p-16` (16px all sides).
      "p-4",
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

        {/* Middle slot — primary navigation. `flex-1` lets it absorb all
          remaining space between the two fixed slots; `max-w-[1200px]`
          keeps the nav icons from spreading too far on ultra-wide viewports. */}
        <nav
          aria-label="Primary"
          className="flex max-w-[1200px] min-w-0 flex-1 items-center gap-8"
          data-node-id="1497:94718"
        >
          {NAV_ITEMS.map((item) => (
            <IconButton
              key={item.key}
              label={item.label}
              active={derivedActive === item.key}
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
          to the right edge of the bar. */}
        <div
          className="relative flex w-40 shrink-0 items-center justify-end"
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
            <>
              <Button
                variant="primary-dark"
                onClick={() => setChooserOpen(true)}
                data-node-id="1497:94725"
              >
                Connect Wallet
              </Button>

              <ConnectChooserModal
                open={chooserOpen}
                onConnectEvm={evm.connect}
                onConnectStellar={stellar.connect}
                onDismiss={() => setChooserOpen(false)}
              />
            </>
          )}
        </div>
      </header>
    );
  },
);

TopBar.displayName = "TopBar";

export default TopBar;

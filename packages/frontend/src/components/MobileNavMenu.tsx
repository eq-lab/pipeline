import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Logo, NavIcon, CoinIcon } from "@pipeline/ui";
import type { NavIconName } from "@pipeline/ui";

/**
 * MobileNavMenu — full-screen slide-in nav panel for mobile viewports.
 *
 * Shown when the user taps the hamburger (`menu-2`) icon in the `TopBar` at
 * viewport widths below the `md` (768px) breakpoint.
 *
 * Disconnected state (Figma node 1989:9231):
 *   - Logo + close (×) button
 *   - Four nav items: Home / Convert / Earn / Activity
 *   - Pipeline Overview item (divider-separated)
 *   - "Connect Wallet" full-width dark CTA
 *
 * Connected state (Figma node 1993:6527):
 *   - Same nav items
 *   - Wallet address row (icon + truncated address + copy)
 *   - USDC balance row (coin icon + balance)
 *   - "Disconnect" button (red text, borderless)
 *
 * Accessibility:
 *   - `role="dialog" aria-modal="true"` — announces as a modal.
 *   - Focus is moved to the first focusable element on open.
 *   - Focus is trapped inside while open.
 *   - Escape closes (handled by `useMobileNavMenu`).
 *   - Scrim click closes.
 */

// ── Focus trap helper ─────────────────────────────────────────────────────────

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(container: HTMLElement, e: KeyboardEvent) {
  const focusable = Array.from<HTMLElement>(
    container.querySelectorAll(FOCUSABLE),
  ).filter((el) => !el.closest("[aria-hidden]"));

  if (focusable.length === 0) return;

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;

  if (e.key === "Tab") {
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}

// ── Inline SVG glyphs ─────────────────────────────────────────────────────────

/** Close × glyph — 24×24. */
function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Hamburger menu-2 glyph — three horizontal bars. */
export function HamburgerGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      aria-hidden="true"
    >
      <path
        d="M3 12h18M3 6h18M3 18h18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Wallet glyph — rendered inline so it paints with currentColor. */
function WalletGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <rect
        x="2"
        y="5"
        width="20"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M2 10h20" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="15" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Copy glyph. */
function CopyGlyph() {
  return (
    <svg
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
      aria-hidden="true"
    >
      <rect
        x="8"
        y="8"
        width="11"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M6 14H4.5C3.67 14 3 13.33 3 12.5V4.5C3 3.67 3.67 3 4.5 3H12.5C13.33 3 14 3.67 14 4.5V6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Pie-chart glyph for Pipeline Overview. */
function PieChartGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <path
        d="M10 2a8 8 0 1 0 8 8h-8V2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 2.5A8 8 0 0 1 17.5 6H14V2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Nav items ─────────────────────────────────────────────────────────────────

interface MenuNavItem {
  key: "home" | "deposit" | "stats" | "history";
  label: string;
  to?: string;
}

const MENU_NAV_ITEMS: ReadonlyArray<MenuNavItem> = [
  { key: "home", label: "Home", to: "/" },
  { key: "deposit", label: "Convert", to: "/deposit" },
  { key: "stats", label: "Earn", to: "/stake" },
  { key: "history", label: "Activity", to: "/transactions" },
];

// ── Nav item row ──────────────────────────────────────────────────────────────

interface NavItemRowProps {
  iconName: NavIconName;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function NavItemRow({
  iconName,
  label,
  active = false,
  onClick,
}: NavItemRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-3",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "focus-visible:ring-[var(--color-pipeline-brand)]",
        "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
        "rounded-[var(--radius-pipeline-button)]",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Filled dark circle icon badge */}
      <div
        className={[
          "flex shrink-0 items-center justify-center",
          "size-10 rounded-full",
          "bg-[var(--color-pipeline-ink)]",
          "text-white",
        ].join(" ")}
        aria-hidden="true"
      >
        <span className="inline-flex size-5 items-center justify-center">
          <NavIcon name={iconName} size={20} />
        </span>
      </div>

      <span
        className={[
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-body)]",
          "leading-[var(--text-pipeline-body--line-height)]",
          "font-[var(--font-weight-regular)]",
          active
            ? "text-[color:var(--color-pipeline-brand)]"
            : "text-[color:var(--color-pipeline-ink-muted)]",
          "truncate",
        ].join(" ")}
      >
        {label}
      </span>
    </button>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────

function MenuDivider() {
  return (
    <div
      className="h-px w-full bg-[var(--color-pipeline-line)]"
      role="separator"
      aria-hidden="true"
    />
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MobileNavMenuProps {
  /** Whether the menu panel is visible. */
  open: boolean;
  /** Called when the menu should close (× button, scrim click, Escape). */
  onClose: () => void;
  /** Current pathname — used to derive the active nav item. */
  pathname: string;
  /** Navigate to a route. */
  onNavigate: (to: string) => void;
  /** Whether any wallet is connected. */
  anyConnected: boolean;
  /** Connected wallet address (EVM or Stellar). */
  address?: string;
  /** Formatted USDC balance, e.g. "$1,000.00". */
  formattedBalance?: string;
  /**
   * Called when the user clicks "Connect Wallet" (disconnected state).
   * Should open the ConnectChooserModal.
   */
  onConnect?: () => void;
  /**
   * Called when the user clicks "Disconnect" (connected state).
   */
  onDisconnect?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MobileNavMenu({
  open,
  onClose,
  pathname,
  onNavigate,
  anyConnected,
  address,
  formattedBalance,
  onConnect,
  onDisconnect,
}: MobileNavMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = "mobile-nav-menu-heading";

  // Focus the first button when opened.
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => {
        const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Focus trap.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (panelRef.current) {
        trapFocus(panelRef.current, e);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Derive active nav from pathname (same logic as TopBar).
  const activeKey: MenuNavItem["key"] =
    pathname === "/deposit"
      ? "deposit"
      : pathname === "/transactions"
        ? "history"
        : pathname === "/stake"
          ? "stats"
          : "home";

  const handleNavClick = useCallback(
    (to: string) => {
      onNavigate(to);
      onClose();
    },
    [onNavigate, onClose],
  );

  const handleConnectClick = useCallback(() => {
    onConnect?.();
    onClose();
  }, [onConnect, onClose]);

  const handleDisconnectClick = useCallback(() => {
    onDisconnect?.();
    onClose();
  }, [onDisconnect, onClose]);

  const handleCopyAddress = useCallback(() => {
    if (address) {
      void navigator.clipboard.writeText(address);
    }
  }, [address]);

  // Shorten address: 0x8493...3b92
  const shortAddress =
    address && address.length > 10
      ? `${address.slice(0, 6)}...${address.slice(-4)}`
      : (address ?? "");

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const menu = (
    // Fixed scrim overlay — tinted backdrop.
    <div
      className="fixed inset-0 z-[9999]"
      style={{ backgroundColor: "rgba(56,55,53,0.6)" }}
      onClick={onClose}
      data-testid="mobile-nav-menu-scrim"
    >
      {/* Panel — slides in from the top; full-width, paper background. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => e.stopPropagation()}
        className={[
          "absolute inset-x-0 top-0",
          "bg-[var(--color-pipeline-paper)]",
          "flex flex-col gap-6",
          "px-2 py-3",
        ].join(" ")}
        data-testid="mobile-nav-menu"
        data-node-id="1989:9231"
      >
        {/* Close button — top-right corner */}
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className={[
            "absolute top-4 right-4",
            "flex size-6 items-center justify-center",
            "rounded-[var(--radius-pipeline-button)]",
            "text-[color:var(--color-pipeline-ink)]",
            "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
            "focus-visible:ring-[var(--color-pipeline-brand)]",
          ].join(" ")}
          data-testid="mobile-nav-menu-close"
        >
          <CloseGlyph />
        </button>

        {/* Logo */}
        <div className="flex items-center" aria-hidden="true">
          <Logo />
        </div>

        {/* Screen-reader heading (visually hidden — logo acts as heading) */}
        <h2 id={headingId} className="sr-only">
          Navigation
        </h2>

        {/* Nav + actions content area */}
        <div className="flex flex-col items-center gap-2 p-4">
          {/* Primary nav items */}
          <nav
            aria-label="Primary"
            className="flex w-full flex-col gap-4"
            data-node-id="1993:6945"
          >
            {MENU_NAV_ITEMS.map((item) => (
              <NavItemRow
                key={item.key}
                iconName={item.key}
                label={item.label}
                active={activeKey === item.key}
                onClick={
                  item.to ? () => handleNavClick(item.to as string) : undefined
                }
              />
            ))}
          </nav>

          {/* Divider before Pipeline Overview */}
          <div className="flex w-full items-center justify-center py-3">
            <MenuDivider />
          </div>

          {/* Pipeline Overview item */}
          <button
            type="button"
            className={[
              "flex w-full items-center gap-3",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              "focus-visible:ring-[var(--color-pipeline-brand)]",
              "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
              "rounded-[var(--radius-pipeline-button)]",
            ].join(" ")}
            data-node-id="1989:9444"
          >
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-pipeline-ink)] text-white"
              aria-hidden="true"
            >
              <PieChartGlyph />
            </div>
            <span
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "truncate",
              ].join(" ")}
            >
              Pipeline Overview
            </span>
          </button>

          {/* Divider before wallet section */}
          <div className="flex w-full items-center justify-center py-3">
            <MenuDivider />
          </div>

          {anyConnected ? (
            <>
              {/* Wallet address row */}
              {address && (
                <div
                  className="flex w-full items-center gap-3 rounded-[var(--radius-pipeline-button)] p-2"
                  data-node-id="1993:6627"
                >
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-pipeline-button)] bg-[var(--color-pipeline-ink)] text-white"
                    aria-hidden="true"
                  >
                    <WalletGlyph />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={[
                        "font-[family-name:var(--font-body)]",
                        "text-[length:var(--text-pipeline-caption)]",
                        "leading-[var(--text-pipeline-caption--line-height)]",
                        "text-[color:var(--color-pipeline-ink-muted)]",
                        "truncate",
                      ].join(" ")}
                    >
                      Wallet
                    </span>
                    <span
                      className={[
                        "font-[family-name:var(--font-body)]",
                        "text-[length:var(--text-pipeline-body)]",
                        "leading-[var(--text-pipeline-body--line-height)]",
                        "text-[color:var(--color-pipeline-ink)]",
                        "truncate",
                      ].join(" ")}
                    >
                      {shortAddress}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Copy address"
                    onClick={handleCopyAddress}
                    className={[
                      "flex size-8 shrink-0 items-center justify-center",
                      "rounded-[var(--radius-pipeline-button)]",
                      "text-[color:var(--color-pipeline-ink-muted)]",
                      "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
                      "focus:outline-none focus-visible:ring-2",
                      "focus-visible:ring-[var(--color-pipeline-brand)]",
                    ].join(" ")}
                  >
                    <CopyGlyph />
                  </button>
                </div>
              )}

              {/* USDC balance row */}
              {formattedBalance && (
                <div
                  className="flex w-full items-center gap-3 rounded-[var(--radius-pipeline-button)] p-2"
                  data-node-id="1993:6744"
                >
                  <div
                    className="flex size-10 shrink-0 items-center justify-center"
                    aria-hidden="true"
                  >
                    <CoinIcon token="usdc" size="lg" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={[
                        "font-[family-name:var(--font-body)]",
                        "text-[length:var(--text-pipeline-caption)]",
                        "leading-[var(--text-pipeline-caption--line-height)]",
                        "text-[color:var(--color-pipeline-ink-muted)]",
                        "truncate",
                      ].join(" ")}
                    >
                      USDC balance
                    </span>
                    <span
                      className={[
                        "font-[family-name:var(--font-body)]",
                        "text-[length:var(--text-pipeline-body)]",
                        "leading-[var(--text-pipeline-body--line-height)]",
                        "text-[color:var(--color-pipeline-ink)]",
                        "truncate",
                      ].join(" ")}
                    >
                      {formattedBalance}
                    </span>
                  </div>
                </div>
              )}

              {/* Divider before Disconnect */}
              <div className="flex w-full items-center justify-center py-3">
                <MenuDivider />
              </div>

              {/* Disconnect button */}
              <button
                type="button"
                onClick={handleDisconnectClick}
                className={[
                  "flex w-full items-center justify-center",
                  "h-12 min-h-12 overflow-hidden px-3",
                  "rounded-[var(--radius-pipeline-button)]",
                  "font-[family-name:var(--font-body)]",
                  "text-[length:var(--text-pipeline-body)]",
                  "leading-[var(--text-pipeline-body--line-height)]",
                  "font-[var(--font-weight-emphasized)]",
                  "text-[color:#b20000]",
                  "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  "focus-visible:ring-[var(--color-pipeline-brand)]",
                ].join(" ")}
                data-node-id="1993:6920"
              >
                Disconnect
              </button>
            </>
          ) : (
            /* Connect Wallet full-width CTA */
            <button
              type="button"
              onClick={handleConnectClick}
              className={[
                "flex w-full items-center justify-center",
                "h-12 min-h-12 overflow-hidden px-3",
                "rounded-[var(--radius-pipeline-button)]",
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "font-[var(--font-weight-emphasized)]",
                "bg-[var(--color-pipeline-cta)]",
                "text-[color:var(--color-pipeline-on-dark)]",
                "transition-colors hover:bg-[color-mix(in_oklab,var(--color-pipeline-cta)_88%,white)]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                "focus-visible:ring-[var(--color-pipeline-brand)]",
              ].join(" ")}
              data-node-id="1993:6600"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(menu, document.body);
}

export default MobileNavMenu;

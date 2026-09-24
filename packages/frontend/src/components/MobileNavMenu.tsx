import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button, Logo, NavIcon } from "@pipeline/ui";
import type { NavIconName } from "@pipeline/ui";
import { NetworkSwitcher } from "./NetworkSwitcher";
import { AccountGlyph } from "./AccountGlyph";
import { isMainnetDeployment } from "@/wallet/networkSwitcher";

// spec: docs/frontend/dashboard-components.md#mobilenavmenu (disconnected/connected states, Figma nodes 1989:9231 / 1993:6527).

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

/** Pie-chart glyph for Dashboard. */
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
  key: "home" | "deposit" | "stats" | "history" | "overview";
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
  testId?: string;
}

function NavItemRow({
  iconName,
  label,
  active = false,
  onClick,
  testId,
}: NavItemRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
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
  /** Whether the LP has an active auth session (issue #1362). */
  isAuthenticated: boolean;
  /** Opens the shared auth flow on the sign-in screen. */
  onSignIn: () => void;
  /** Opens the shared auth flow on the create-account screen. */
  onSignUp: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MobileNavMenu({
  open,
  onClose,
  pathname,
  onNavigate,
  isAuthenticated,
  onSignIn,
  onSignUp,
}: MobileNavMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = "mobile-nav-menu-heading";

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => {
        const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [open]);

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
          : pathname === "/dashboard"
            ? "overview"
            : "home";

  const handleNavClick = useCallback(
    (to: string) => {
      onNavigate(to);
      onClose();
    },
    [onNavigate, onClose],
  );

  const handleSignInClick = useCallback(() => {
    onSignIn();
    onClose();
  }, [onSignIn, onClose]);

  const handleSignUpClick = useCallback(() => {
    onSignUp();
    onClose();
  }, [onSignUp, onClose]);

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
        <div
          className="flex items-center"
          aria-hidden="true"
          data-testid="mobile-nav-logo"
        >
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
            data-testid="mobile-primary-nav"
            data-node-id="1993:6945"
          >
            {MENU_NAV_ITEMS.map((item) => (
              <NavItemRow
                key={item.key}
                iconName={item.key}
                label={item.label}
                active={activeKey === item.key}
                testId={`mobile-nav-${item.key}`}
                onClick={
                  item.to ? () => handleNavClick(item.to as string) : undefined
                }
              />
            ))}
          </nav>

          {/* Dashboard item + preceding divider — hidden on mainnet, Issue #1243 */}
          {!isMainnetDeployment() && (
            <>
              <div className="flex w-full items-center justify-center py-3">
                <MenuDivider />
              </div>

              <button
                type="button"
                className={[
                  "flex w-full items-center gap-3",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  "focus-visible:ring-[var(--color-pipeline-brand)]",
                  "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
                  "rounded-[var(--radius-pipeline-button)]",
                ].join(" ")}
                data-testid="mobile-overview-button"
                data-node-id="1989:9444"
                onClick={() => handleNavClick("/dashboard")}
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
                  Dashboard
                </span>
              </button>
            </>
          )}

          {/* Divider before wallet section */}
          <div className="flex w-full items-center justify-center py-3">
            <MenuDivider />
          </div>

          <div
            className="flex w-full items-center justify-between p-2"
            data-testid="mobile-network-switcher"
          >
            <span
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
              ].join(" ")}
            >
              Network
            </span>
            <NetworkSwitcher />
          </div>

          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => handleNavClick("/account")}
              className={[
                "flex w-full items-center gap-3",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                "focus-visible:ring-[var(--color-pipeline-brand)]",
                "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
                "rounded-[var(--radius-pipeline-button)]",
              ].join(" ")}
              data-testid="mobile-account-button"
              data-node-id="6701:97941"
            >
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-pipeline-ink)] text-white"
                aria-hidden="true"
              >
                <AccountGlyph size={20} />
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
                Account
              </span>
            </button>
          ) : (
            <div className="flex w-full flex-col gap-2">
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleSignInClick}
                data-testid="mobile-sign-in-button"
                data-node-id="6701:98415"
              >
                Sign In
              </Button>
              <Button
                variant="primary-dark"
                className="w-full"
                onClick={handleSignUpClick}
                data-testid="mobile-sign-up-button"
                data-node-id="6701:98416"
              >
                Sign Up
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(menu, document.body);
}

export default MobileNavMenu;

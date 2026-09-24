import React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Button, IconButton, Logo, NavIcon } from "@pipeline/ui";
import { useAuthFlow, useAuthSession } from "@/auth";
import { NetworkSwitcher } from "./NetworkSwitcher";
import { AccountGlyph } from "./AccountGlyph";
import { MobileNavMenu, HamburgerGlyph } from "./MobileNavMenu";
import { useMobileNavMenu } from "./useMobileNavMenu";
import { isMainnetDeployment } from "@/wallet/networkSwitcher";

// spec: docs/frontend/dashboard-components.md#topbar
// (connected/disconnected states, active-nav derivation, Figma frame 1497:94715).

/** One nav slot: icon + accessible label + optional route target. */
interface NavItem {
  key: "home" | "deposit" | "stats" | "history" | "overview";
  label: string;
  /** TanStack Router path this slot navigates to; omit for slots with no route yet. */
  to?: string;
  dividerBefore?: boolean;
}

// Figma order, node ids on the side for traceability.
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { key: "home", label: "Home", to: "/" }, // 1497:94719
  { key: "deposit", label: "Convert", to: "/deposit" }, // 1497:94720
  { key: "stats", label: "Earn", to: "/stake" }, //     1497:94721
  { key: "history", label: "Activity", to: "/transactions" }, // 1497:94722
  {
    key: "overview",
    label: "Dashboard",
    to: "/dashboard",
    dividerBefore: true,
  }, // 5915:77655
];

export type TopBarProps = React.HTMLAttributes<HTMLElement>;

export const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  function TopBar({ className, ...rest }, ref) {
    const navigate = useNavigate();
    const pathname = useRouterState({ select: (s) => s.location.pathname });

    // spec: docs/frontend/dashboard-components.md#topbar (mainnet gate, Issue #1243)
    const navItems = isMainnetDeployment()
      ? NAV_ITEMS.filter((item) => item.key !== "overview")
      : NAV_ITEMS;

    // ── Auth state (issue #1362 — header sign-in/sign-up/account entry) ───
    const { isAuthenticated } = useAuthSession();
    const { open: openAuthFlow } = useAuthFlow();

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
            : pathname === "/dashboard"
              ? "overview"
              : pathname === "/"
                ? "home"
                : "home";

    const composed = [
      "flex items-center justify-between",
      // spec: docs/frontend/dashboard-components.md#topbar (mobile height, Figma node 1989:9052).
      "p-2 md:p-4",
      "w-full",
      "bg-[var(--color-pipeline-paper)]",
      "border-b border-[var(--color-pipeline-line)]",
      // Position context for the dropdown; sticky per #1238.
      "sticky top-0 z-40",
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
        {/* spec: docs/frontend/dashboard-components.md#topbar (logo slot sizing, Figma node 1497:94716). */}
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
          {navItems.map((item) => (
            <React.Fragment key={item.key}>
              {item.dividerBefore && (
                <span
                  aria-hidden="true"
                  className="h-5 w-px shrink-0 bg-[var(--color-pipeline-line)]"
                  data-testid="topbar-nav-divider"
                  data-node-id="5915:77654"
                />
              )}
              <IconButton
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
            </React.Fragment>
          ))}
        </nav>

        {/* Right slot — desktop auth controls (md and above), Figma nodes 6701:98403 (signed out) / 6701:97929 (signed in). */}
        <div
          className="relative hidden min-w-40 shrink-0 items-center justify-end gap-2 md:flex"
          data-testid="topbar-wallet-slot"
          data-node-id="1497:94724"
        >
          <NetworkSwitcher />
          {isAuthenticated ? (
            <button
              type="button"
              aria-label="Account"
              onClick={() =>
                void navigate({ to: "/account", search: { state: undefined } })
              }
              className={[
                "flex size-12 shrink-0 items-center justify-center",
                "rounded-[var(--radius-pipeline-button)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "transition-colors hover:bg-[color-mix(in_oklab,var(--color-pipeline-ink)_8%,transparent)]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                "focus-visible:ring-[var(--color-pipeline-brand)]",
              ].join(" ")}
              data-testid="topbar-account-button"
              data-node-id="6701:97941"
            >
              <AccountGlyph />
            </button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => openAuthFlow("sign-in")}
                data-testid="topbar-sign-in-button"
                data-node-id="6701:98415"
              >
                Sign In
              </Button>
              <Button
                variant="primary-dark"
                onClick={() => openAuthFlow("create-account")}
                data-testid="topbar-sign-up-button"
                data-node-id="6701:98416"
              >
                Sign Up
              </Button>
            </>
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
          isAuthenticated={isAuthenticated}
          onSignIn={() => openAuthFlow("sign-in")}
          onSignUp={() => openAuthFlow("create-account")}
        />
      </header>
    );
  },
);

TopBar.displayName = "TopBar";

export default TopBar;

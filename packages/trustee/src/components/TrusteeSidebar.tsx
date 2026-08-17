/**
 * TrusteeSidebar — the persistent left nav panel, replacing the earlier
 * topbar nav.
 *
 * spec: docs/frontend/trustee-flows.md#trustee-sidebar-figma-node-41168855-aside
 * (incl. the #1032 network switcher, detailed in
 * docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links).
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Logo, NetworkSwitchDialog } from "@pipeline/ui";
import { TRUSTEE_NAV_ITEMS, type TrusteeNavItem } from "@/lib/nav";
import { truncateAddress } from "@/lib/truncateAddress";
import {
  getNetworkSwitcherState,
  navigateToNetworkLink,
  shouldConfirmNetworkSwitch,
  type NetworkLink,
} from "@/lib/networkSwitcher";
import { useTrusteeSession } from "@/auth/TrusteeSessionProvider";
import {
  OverviewIcon,
  OriginationIcon,
  LoansIcon,
  CashManagementIcon,
  RiskCouncilIcon,
  AuditLogIcon,
  AvatarIcon,
} from "@/components/TrusteeNavIcons";
import type { ComponentType, SVGProps } from "react";

// Documented scoped one-offs (no theme token exists) — same precedent as
// `SignInCard.tsx`.
const DIVIDER_COLOR = "rgba(235,233,230,0.25)";
const SUBTITLE_COLOR = "rgba(235,233,230,0.7)";
const BADGE_BG_COLOR = "rgba(191,189,187,0.24)";

const NAV_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  "/": OverviewIcon,
  "/origination": OriginationIcon,
  "/loans": LoansIcon,
  "/cash-management": CashManagementIcon,
  "/risk-council": RiskCouncilIcon,
  "/audit-log": AuditLogIcon,
};

// Divider placement, per the Figma frame: after Overview, and before the
// Risk Council / Audit Log group.
const DIVIDER_AFTER_PATHS = new Set(["/", "/cash-management"]);

function NavBadge({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span
      className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[4px] px-[7.5px] text-center font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] text-[color:var(--color-pipeline-on-dark)]"
      style={{ backgroundColor: BADGE_BG_COLOR }}
      data-testid="trustee-nav-badge"
    >
      {count}
    </span>
  );
}

// spec: docs/frontend/trustee-flows.md#trustee-sidebar-figma-node-41168855-aside.
const NAV_ITEM_BASE_CLASSNAME =
  "flex h-14 w-full shrink-0 items-center gap-[14px] rounded-[4px] px-4";

function NavItem({ item }: { item: TrusteeNavItem }) {
  const Icon = NAV_ICONS[item.path];
  return (
    <Link
      to={item.path}
      className={NAV_ITEM_BASE_CLASSNAME}
      activeOptions={{ exact: item.path === "/" }}
      activeProps={{
        className:
          "bg-[color:var(--color-pipeline-surface)] text-[color:var(--color-pipeline-brand)]",
        "aria-current": "page",
      }}
      inactiveProps={{
        className: "text-[color:var(--color-pipeline-on-dark)]",
      }}
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {Icon ? <Icon /> : null}
      </span>
      <span className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] whitespace-nowrap">
        {item.navLabel}
      </span>
      <NavBadge count={item.badgeCount} />
    </Link>
  );
}

function Divider() {
  return (
    <div className="w-full shrink-0 py-3" aria-hidden="true">
      <div
        className="border-t border-solid"
        style={{ borderColor: DIVIDER_COLOR }}
      />
    </div>
  );
}

// Testnet dot is a muted on-dark tone; mainnet's is the amber "warning"
// token so it reads as a real-funds signal against the dark surfaces here
// (a navy dot on the navy sidebar/chip would be effectively invisible).
function networkDotClasses(id: string): string {
  return [
    "size-1.5 shrink-0 rounded-full",
    id === "mainnet"
      ? "bg-[color:var(--color-pipeline-warning)]"
      : "bg-white/40",
  ].join(" ");
}

/**
 * The account chip's "⋯" popover menu: switch-network rows (only when
 * `otherNetworks` is non-empty) above "Sign out".
 */
function AccountMenu({
  otherNetworks,
  onSignOut,
}: {
  otherNetworks: NetworkLink[];
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Mainnet-bound switches confirm via the styled dialog (#1032).
  const [pendingLink, setPendingLink] = useState<NetworkLink | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex cursor-pointer items-center justify-center bg-transparent p-0 text-[18px] leading-none opacity-70"
        style={{ color: SUBTITLE_COLOR }}
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 bottom-full mb-2 min-w-[180px] rounded-[4px] border border-solid border-[color:var(--color-pipeline-line)] bg-[color:var(--color-pipeline-surface)] py-1 shadow-lg"
        >
          {otherNetworks.length > 0 && (
            <>
              <div
                role="group"
                aria-label="Switch network"
                className="flex flex-col"
                data-testid="trustee-network-switcher-group"
              >
                {otherNetworks.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      if (shouldConfirmNetworkSwitch(link)) {
                        setPendingLink(link);
                      } else {
                        navigateToNetworkLink(link);
                      }
                    }}
                    data-testid={`trustee-network-link-${link.id}`}
                    className="flex w-full cursor-pointer items-center gap-2 bg-transparent px-3 py-2 text-left font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink)] hover:bg-[color:var(--color-pipeline-surface-muted)]"
                  >
                    <span
                      className={networkDotClasses(link.id)}
                      aria-hidden="true"
                    />
                    Switch to {link.label}
                  </button>
                ))}
              </div>
              <div
                className="my-1 h-px border-t border-solid border-[color:var(--color-pipeline-line)]"
                role="separator"
                aria-hidden="true"
              />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="w-full cursor-pointer bg-transparent px-3 py-2 text-left font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink)] hover:bg-[color:var(--color-pipeline-surface-muted)]"
          >
            Sign out
          </button>
        </div>
      ) : null}
      <NetworkSwitchDialog
        open={pendingLink !== null}
        targetLabel={pendingLink?.label ?? ""}
        isMainnet={pendingLink?.id === "mainnet"}
        onCancel={() => setPendingLink(null)}
        onConfirm={() => {
          if (pendingLink) navigateToNetworkLink(pendingLink);
        }}
      />
    </div>
  );
}

function AccountChip() {
  const { address, signOut } = useTrusteeSession();
  const { currentNetwork, otherNetworks } = getNetworkSwitcherState();

  if (!address) return null;

  return (
    <div
      className="flex w-full shrink-0 items-center gap-3 border-t border-solid px-2 pt-[11px] pb-[10px]"
      style={{ borderColor: DIVIDER_COLOR }}
      data-testid="trustee-account-chip"
    >
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-solid border-white text-white"
        aria-hidden="true"
      >
        <AvatarIcon width={15} height={15} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-on-dark)]"
          title={address}
          data-testid="trustee-account-address"
        >
          {truncateAddress(address)}
        </span>
        {/* Subtitle row: "Trustee · connected" with the current-network pill
            beside it — always visible, no menu required (issue #1032
            acceptance: "active network always labeled"). Tinted pill so the
            active network is unmissable on the navy sidebar; mainnet gets
            the amber accent. */}
        <span className="flex items-center gap-2">
          <span
            className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] whitespace-nowrap"
            style={{ color: SUBTITLE_COLOR }}
          >
            Trustee · connected
          </span>
          <span
            className={[
              "inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5",
              "font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] font-[var(--font-weight-medium)] whitespace-nowrap",
              currentNetwork.id === "mainnet"
                ? "bg-[color:var(--color-pipeline-warning)]/20 text-[color:var(--color-pipeline-warning)]"
                : "bg-white/12 text-white/85",
            ].join(" ")}
            data-testid="trustee-network-badge"
          >
            <span
              className={networkDotClasses(currentNetwork.id)}
              aria-hidden="true"
            />
            {currentNetwork.label}
          </span>
        </span>
      </div>

      <AccountMenu otherNetworks={otherNetworks} onSignOut={signOut} />
    </div>
  );
}

export function TrusteeSidebar() {
  return (
    <aside
      className="sticky top-0 flex h-screen w-[320px] shrink-0 flex-col overflow-y-auto bg-[color:var(--color-pipeline-brand)] px-4 py-6"
      aria-label="Trustee navigation"
    >
      <div className="w-full shrink-0 pb-[26px]">
        <Logo
          width={116}
          // `Logo` defaults to an inline `style={{ color: brand }}`, which
          // beats a Tailwind text-color className on specificity — override
          // via `style` (same pattern as ConnectWalletModal.tsx on the LP
          // app's dark surface) so the wordmark actually renders white here.
          style={{ color: "var(--color-pipeline-on-dark)" }}
        />
      </div>

      <nav
        aria-label="Trustee sections"
        className="flex w-full flex-1 flex-col items-start overflow-y-auto"
      >
        {TRUSTEE_NAV_ITEMS.map((item) => (
          <Fragment key={item.path}>
            <NavItem item={item} />
            {DIVIDER_AFTER_PATHS.has(item.path) ? <Divider /> : null}
          </Fragment>
        ))}
      </nav>

      <AccountChip />
    </aside>
  );
}

export default TrusteeSidebar;

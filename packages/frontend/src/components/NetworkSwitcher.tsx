// spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
import { useEffect, useRef, useState } from "react";
import { NetworkSwitchDialog } from "@pipeline/ui";
import { getNetworkSwitcherState } from "@/wallet/networkSwitcher";
import { useNetworkSwitch } from "@/wallet/useNetworkSwitch";

/**
 * TopBar network pill (issue #1032) — the always-visible current-network
 * indicator, upgraded from a static label to a control: when sibling
 * deployments are configured it opens a small popover listing them, and
 * mainnet-bound switches confirm via the shared `NetworkSwitchDialog`.
 * Renders as a non-interactive pill when no siblings are configured.
 */
export function NetworkSwitcher() {
  const { currentNetwork, otherNetworks } = getNetworkSwitcherState();
  const { pendingLink, requestSwitch, confirmSwitch, cancelSwitch } =
    useNetworkSwitch();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const isMainnet = currentNetwork.id === "mainnet";
  const hasMenu = otherNetworks.length > 0;

  const pillInner = (
    <>
      <span
        className={[
          "size-2 shrink-0 rounded-full",
          isMainnet
            ? "bg-[color:var(--color-pipeline-warning)]"
            : "bg-[color:var(--color-pipeline-positive)]",
        ].join(" ")}
        aria-hidden="true"
      />
      <span className="text-[15px] leading-none font-[var(--font-weight-medium)] whitespace-nowrap text-[color:var(--color-pipeline-ink)]">
        {currentNetwork.label}
      </span>
    </>
  );

  const pillClasses = [
    "flex h-12 items-center gap-2 px-4",
    "rounded-[var(--radius-pipeline-card)]",
    isMainnet
      ? "bg-[color:var(--color-pipeline-warning)]/10"
      : "bg-[var(--color-pipeline-surface)]",
  ].join(" ");

  return (
    <div ref={rootRef} className="relative shrink-0">
      {hasMenu ? (
        <button
          type="button"
          data-testid="topbar-network-badge"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={[
            pillClasses,
            "cursor-pointer text-[color:var(--color-pipeline-ink)] transition-opacity hover:opacity-80",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--color-pipeline-ink)]/30",
          ].join(" ")}
        >
          {pillInner}
          {/* Chevron — signals the pill opens a menu. */}
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            aria-hidden="true"
            className={open ? "rotate-180" : undefined}
          >
            <path
              d="M1 1L5 5L9 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <div
          data-testid="topbar-network-badge"
          title={currentNetwork.label}
          className={pillClasses}
        >
          {pillInner}
        </div>
      )}

      {open && hasMenu && (
        <div
          role="menu"
          aria-label="Switch network"
          data-testid="topbar-network-menu"
          className="absolute right-0 z-40 mt-2 flex min-w-[180px] flex-col rounded-[var(--radius-pipeline-card)] border border-[color:var(--color-pipeline-line)] bg-white py-1.5 shadow-[0px_8px_28px_0px_rgba(0,0,40,0.14)]"
        >
          {otherNetworks.map((link) => (
            <button
              key={link.id}
              type="button"
              role="menuitem"
              data-testid={`topbar-network-link-${link.id}`}
              onClick={() => {
                setOpen(false);
                requestSwitch(link);
              }}
              className="flex items-center gap-2 px-4 py-2.5 text-left font-[family-name:var(--font-body)] text-[15px] whitespace-nowrap text-[color:var(--color-pipeline-ink)] transition-colors hover:bg-[color:var(--color-pipeline-line)]/30"
            >
              <span
                className={[
                  "size-2 shrink-0 rounded-full",
                  link.id === "mainnet"
                    ? "bg-[color:var(--color-pipeline-warning)]"
                    : "bg-[color:var(--color-pipeline-ink-muted)]",
                ].join(" ")}
                aria-hidden="true"
              />
              Switch to {link.label}
            </button>
          ))}
        </div>
      )}

      <NetworkSwitchDialog
        open={pendingLink !== null}
        targetLabel={pendingLink?.label ?? ""}
        isMainnet={pendingLink?.id === "mainnet"}
        onCancel={cancelSwitch}
        onConfirm={confirmSwitch}
      />
    </div>
  );
}

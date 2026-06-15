/**
 * ConnectWalletModal — full wallet-selection modal (Issues #558, #563).
 *
 * Renders a full-viewport two-pane layout (desktop) or single-column (mobile):
 *   Left:  "Connect Wallet" heading, EVM / Soroban tab control, per-wallet
 *          rows with brand icons and direct connect actions.
 *   Right: background photo + Pipeline logo + marketing headline.
 *          Hidden on mobile (below lg breakpoint).
 *
 * Tab set: EVM (Ethereum-compatible wallets) | Soroban (Stellar wallets).
 * No "All" aggregate tab.
 *
 * Per-wallet behaviour:
 *   - Wallet available → connect directly (wagmi connector or kit setWallet).
 *   - Wallet unavailable → open wallet's website in a new browser tab.
 *
 * Show More: appears when a tab has more than 5 wallets; toggles the full list.
 *
 * Entry point: called from TopBar (replaces ConnectChooserModal).
 *
 * Accessibility: `role="dialog" aria-modal="true"`, focus trap, Escape dismiss,
 * body-scroll lock. Dismissal is via the × button and Escape only (no scrim click).
 *
 * Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2858-57637
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SegmentedTabs } from "@pipeline/ui";
import { useEvmConnectors, useStellarConnectors } from "@/wallet";
import type { EvmWalletConnectorId } from "@/wallet";

// ── Focus trap ────────────────────────────────────────────────────────────────

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

// ── Wallet catalogue ──────────────────────────────────────────────────────────

type WalletTab = "evm" | "soroban";

interface WalletEntry {
  /** Unique id within the Connect modal. */
  id: string;
  label: string;
  /** Short secondary caption (e.g. "Recent"). */
  caption?: string;
  tab: WalletTab;
  /** URL to open if the wallet is unavailable. */
  websiteUrl: string;
  /** SVG content rendered as the 24×24 icon (inline, not a URL). */
  icon: React.ReactNode;
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function MetaMaskIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M20.982 2L13.14 7.743l1.459-3.44L20.982 2z" fill="#E2761B" stroke="#E2761B" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3.01 2l7.778 5.8-1.388-3.497L3.01 2z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M18.153 16.09l-2.089 3.198 4.471 1.23 1.284-4.36-3.666-.068z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.19 16.158l1.276 4.36 4.47-1.23-2.087-3.198-3.66.068z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.7 10.565l-1.25 1.887 4.452.198-.148-4.787L7.7 10.565z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16.291 10.565l-3.084-2.758-.099 4.843 4.443-.198-1.26-1.887z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.936 19.288l2.674-1.302-2.306-1.8-.368 3.102z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.382 17.986l2.683 1.302-.377-3.102-2.306 1.8z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CoinbaseIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#0052FF"/>
      <path d="M12 7a5 5 0 100 10A5 5 0 0012 7zm0 7.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" fill="white"/>
    </svg>
  );
}

function WalletConnectIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6.095 8.26C9.368 4.986 14.632 4.986 17.905 8.26l.395.394a.405.405 0 010 .573l-1.35 1.351a.213.213 0 01-.198.007l-.546-.546c-2.251-2.251-5.902-2.251-8.153 0l-.585.585a.213.213 0 01-.197.007l-1.351-1.35a.405.405 0 010-.573l.175-.448zM20.562 10.917l1.201 1.201a.405.405 0 010 .573l-5.412 5.412c-.158.158-.415.158-.573 0l-3.84-3.84a.107.107 0 00-.098.003l-3.84 3.84c-.158.158-.415.158-.573 0L2.015 12.69a.405.405 0 010-.573l1.2-1.2c.159-.158.416-.158.574 0l3.84 3.84a.107.107 0 00.098-.003l3.84-3.84c.158-.158.415-.158.573 0l3.84 3.84a.107.107 0 00.098.003l3.84-3.84c.158-.158.415-.158.573 0z" fill="#3B99FC"/>
    </svg>
  );
}

function TrustWalletIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 2L4 5.5v6.1C4 16.1 7.4 20.4 12 22c4.6-1.6 8-5.9 8-10.4V5.5L12 2z" fill="#3375BB"/>
      <path d="M12 5l-5 2.2v3.9C7 14.5 9.2 17.6 12 18.8c2.8-1.2 5-4.3 5-7.7V7.2L12 5z" fill="white"/>
    </svg>
  );
}

function FreighterIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#5F2BE2"/>
      <path d="M6 8h12M6 12h8M6 16h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function LobstrIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#000033"/>
      <path d="M7 12a5 5 0 1110 0 5 5 0 01-10 0z" fill="#00C2C2"/>
      <path d="M10 12a2 2 0 114 0 2 2 0 01-4 0z" fill="white"/>
    </svg>
  );
}

function XbullIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#1B1B2F"/>
      <path d="M7 7l10 10M17 7L7 17" stroke="#FCD34D" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function HanaIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="24" height="24" rx="12" fill="#E91E8C"/>
      <path d="M7 12h10M12 7v10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function AlbedoIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#191919"/>
      <circle cx="12" cy="12" r="5" stroke="#F6C90E" strokeWidth="2"/>
      <circle cx="12" cy="12" r="2" fill="#F6C90E"/>
    </svg>
  );
}

function RabetIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#271D3C"/>
      <path d="M7 8h5a3 3 0 010 6H7V8zm0 6h7l3 4H7v-4z" fill="#8B5CF6"/>
    </svg>
  );
}

// ── Wallet catalogue definition ───────────────────────────────────────────────

/** EVM connectors and their metadata. */
const EVM_WALLETS: Omit<WalletEntry, "tab">[] = [
  {
    id: "injected",
    label: "MetaMask",
    websiteUrl: "https://metamask.io",
    icon: <MetaMaskIcon />,
  },
  {
    id: "coinbaseWallet",
    label: "Coinbase Wallet",
    websiteUrl: "https://www.coinbase.com/wallet",
    icon: <CoinbaseIcon />,
  },
  {
    id: "walletConnect",
    label: "WalletConnect",
    websiteUrl: "https://walletconnect.com",
    icon: <WalletConnectIcon />,
  },
  {
    id: "trust",
    label: "Trust Wallet",
    websiteUrl: "https://trustwallet.com",
    icon: <TrustWalletIcon />,
  },
];

/** Soroban wallets and their metadata. */
const SOROBAN_WALLETS: Omit<WalletEntry, "tab">[] = [
  {
    id: "freighter",
    label: "Freighter",
    websiteUrl: "https://www.freighter.app",
    icon: <FreighterIcon />,
  },
  {
    id: "lobstr",
    label: "LOBSTR",
    websiteUrl: "https://lobstr.co",
    icon: <LobstrIcon />,
  },
  {
    id: "xbull",
    label: "xBull",
    websiteUrl: "https://xbull.app",
    icon: <XbullIcon />,
  },
  {
    id: "hana",
    label: "Hana",
    websiteUrl: "https://www.hanawallet.io",
    icon: <HanaIcon />,
  },
  {
    id: "albedo",
    label: "Albedo",
    websiteUrl: "https://albedo.link",
    icon: <AlbedoIcon />,
  },
  {
    id: "rabet",
    label: "Rabet",
    websiteUrl: "https://rabet.io",
    icon: <RabetIcon />,
  },
];

/** Number of wallets shown before "Show More" appears. */
const SHOW_MORE_THRESHOLD = 5;

// ── Close icon ────────────────────────────────────────────────────────────────

function CloseIcon() {
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

// ── WalletRow component ───────────────────────────────────────────────────────

interface WalletRowProps {
  label: string;
  caption?: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function WalletRow({ label, caption, icon, onClick }: WalletRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Connect ${label}`}
      className={[
        // Layout: full-width row, 56px tall, flex between label and icon
        "flex w-full items-center justify-between",
        "h-[56px] shrink-0 px-0",
        // Bottom border matching Figma spec: rgba(56,55,53,0.18)
        "border-b border-[rgba(56,55,53,0.18)]",
        // Interaction
        "cursor-pointer bg-transparent",
        "transition-colors duration-150",
        "hover:bg-[rgba(56,55,53,0.04)]",
        "focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-pipeline-ink)]",
        "focus-visible:-outline-offset-2",
      ].join(" ")}
    >
      {/* Left: name + optional caption */}
      <div className="flex min-w-0 flex-1 flex-col items-start justify-center">
        <span
          className={[
            "block truncate",
            // Body Emphasized: Graphik LC Semi Bold 16/22
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "font-[var(--font-weight-emphasized)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          {label}
        </span>
        {caption ? (
          <span
            className={[
              "block truncate",
              // Caption: Graphik LC Regular 12/16
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            {caption}
          </span>
        ) : null}
      </div>

      {/* Right: 24×24 wallet icon */}
      <span className="ml-3 shrink-0" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

// ── Right image panel (desktop only) ─────────────────────────────────────────

function RightImagePanel() {
  return (
    <div
      className="relative hidden h-full flex-1 overflow-hidden lg:flex lg:flex-col lg:gap-6 lg:p-12"
      aria-hidden="true"
    >
      {/* Background photo — using a pipeline-themed deep-blue/teal gradient
          since the Figma uses a proprietary aerial photo asset. */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(135deg, #0a1628 0%, #0d3f6e 50%, #0a4d4d 100%)",
        }}
      />
      {/* Texture overlay */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
        }}
      />

      {/* Content — Pipeline logo and headline */}
      <div className="relative z-10 flex h-full flex-col justify-between">
        {/* Logo — inline SVG replica of the Pipeline wordmark in white */}
        <div className="h-8 w-[116px] shrink-0">
          <svg
            viewBox="0 0 116 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            width={116}
            height={32}
            aria-label="Pipeline"
          >
            <text
              x="0"
              y="24"
              fontFamily="Besley, serif"
              fontSize="24"
              fill="white"
              fontWeight="400"
            >
              Pipeline
            </text>
          </svg>
        </div>

        {/* Headline */}
        <p
          className={[
            "relative z-10",
            "font-[family-name:var(--font-display)]",
            "text-[length:var(--text-pipeline-heading-l)]",
            "leading-[var(--text-pipeline-heading-l--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-white",
          ].join(" ")}
        >
          Access real-world
          <br />
          yield on-chain
        </p>
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ConnectWalletModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when the user dismisses (Escape / scrim / × button). */
  onDismiss: () => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function ConnectWalletModal({ open, onDismiss }: ConnectWalletModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = "connect-wallet-modal-heading";

  const [activeTab, setActiveTab] = useState<WalletTab>("evm");
  const [showMore, setShowMore] = useState(false);

  // Reset showMore when tab changes
  const handleTabChange = useCallback((id: string) => {
    setActiveTab(id as WalletTab);
    setShowMore(false);
  }, []);

  // EVM per-wallet connect hook
  const { connectWallet: connectEvmWallet } = useEvmConnectors();
  // Soroban per-wallet connect hook
  const { connectWallet: connectSorobanWallet } = useStellarConnectors();

  // Focus the first focusable element when opened.
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => {
        const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Escape key.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onDismiss]);

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

  // Body scroll lock.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Wallet list for the active tab
  const walletEntries = activeTab === "evm" ? EVM_WALLETS : SOROBAN_WALLETS;
  const needsShowMore = walletEntries.length > SHOW_MORE_THRESHOLD;
  const visibleWallets = needsShowMore && !showMore
    ? walletEntries.slice(0, SHOW_MORE_THRESHOLD)
    : walletEntries;

  function handleEvmWalletClick(entry: (typeof EVM_WALLETS)[number]) {
    onDismiss();
    // Trust wallet → open website (no dedicated connector)
    if (entry.id === "trust") {
      window.open(entry.websiteUrl, "_blank", "noopener,noreferrer");
      return;
    }
    connectEvmWallet(entry.id as EvmWalletConnectorId);
  }

  function handleSorobanWalletClick(entry: (typeof SOROBAN_WALLETS)[number]) {
    onDismiss();
    void connectSorobanWallet(entry.id, () => {
      window.open(entry.websiteUrl, "_blank", "noopener,noreferrer");
    });
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const modal = (
    // Full-viewport overlay — no scrim/backdrop; panel fills the screen
    <div
      className="fixed inset-0 z-[9999] flex"
      data-testid="connect-wallet-modal-overlay"
    >
      {/* Modal panel — full viewport, two equal panes on desktop */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={[
          "relative flex h-full w-full overflow-hidden",
          "bg-[var(--color-pipeline-paper)]",
        ].join(" ")}
        data-testid="connect-wallet-modal"
      >
        {/* Left: Connect content — equal half on desktop, full width on mobile */}
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 lg:px-8 lg:py-12">
          <div className="flex w-full max-w-[400px] flex-col gap-6">
            {/* Heading: Besley Regular 48/56, ink primary */}
            <h2
              id={headingId}
              className={[
                "m-0",
                "font-[family-name:var(--font-display)]",
                "text-[length:var(--text-pipeline-heading-l)]",
                "leading-[var(--text-pipeline-heading-l--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
            >
              Connect Wallet
            </h2>

            {/* Tab control + wallet list */}
            <div className="flex flex-col gap-4">
              {/* EVM / Soroban tabs */}
              <SegmentedTabs
                variant="track"
                tabs={[
                  { id: "evm", label: "EVM" },
                  { id: "soroban", label: "Soroban" },
                ]}
                activeId={activeTab}
                onSelect={handleTabChange}
              />

              {/* Wallet rows */}
              <div className="flex flex-col" role="list">
                {visibleWallets.map((entry) => (
                  <div role="listitem" key={entry.id}>
                    <WalletRow
                      label={entry.label}
                      caption={entry.caption}
                      icon={entry.icon}
                      onClick={
                        activeTab === "evm"
                          ? () => handleEvmWalletClick(entry as (typeof EVM_WALLETS)[number])
                          : () => handleSorobanWalletClick(entry as (typeof SOROBAN_WALLETS)[number])
                      }
                    />
                  </div>
                ))}
              </div>

              {/* Show More button — only if the tab has >5 wallets and we haven't expanded yet */}
              {needsShowMore && !showMore ? (
                <button
                  type="button"
                  onClick={() => setShowMore(true)}
                  className={[
                    "flex h-12 w-full items-center justify-center",
                    "font-[family-name:var(--font-body)]",
                    "text-[length:var(--text-pipeline-body)]",
                    "leading-[var(--text-pipeline-body--line-height)]",
                    "font-[var(--font-weight-emphasized)]",
                    "text-[color:var(--color-pipeline-ink-muted)]",
                    "cursor-pointer bg-transparent",
                    "transition-colors duration-150",
                    "hover:text-[color:var(--color-pipeline-ink)]",
                    "focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-pipeline-ink)]",
                  ].join(" ")}
                >
                  Show More
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right: Image panel (desktop only) */}
        <RightImagePanel />

        {/* Close (×) button — positioned top-right of the entire modal */}
        <button
          type="button"
          aria-label="Close"
          onClick={onDismiss}
          className={[
            "absolute right-4 top-4 z-10",
            "flex h-8 w-8 items-center justify-center",
            "rounded-[var(--radius-pipeline-card)]",
            "text-[color:var(--color-pipeline-ink)]",
            "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
          ].join(" ")}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default ConnectWalletModal;

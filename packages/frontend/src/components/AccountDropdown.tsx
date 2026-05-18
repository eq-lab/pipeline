/**
 * AccountDropdown — the panel that opens when the user clicks the WalletPill.
 *
 * Anchored under the WalletPill (absolute, right-aligned), dark surface.
 *
 * Figma reference: node 1506:104728 inside `Header / Connected` (1497:94752).
 *
 * Accepts:
 *   - `address`          — connected wallet address (full `0x…` string).
 *   - `formattedBalance` — pre-formatted USDC balance string, e.g. `"$1,000.00"`.
 *   - `onClose`          — called when the panel should be dismissed.
 *   - `onDisconnect`     — called when the user clicks Disconnect.
 *
 * This component is composed inside `TopBar` and is NOT exported from
 * `@pipeline/ui` (single-owner rule per docs/FRONTEND.md rule 2).
 */
import { useEffect, useRef } from "react";
import { CoinIcon } from "@pipeline/ui";
import { useAccountDropdown } from "./useAccountDropdown";

// ── Inline SVG glyphs ─────────────────────────────────────────────────────────

/** Wallet glyph — rendered inline so it inherits `color: currentColor`. */
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

/** Check / tick glyph (shown while `copied` is true). */
function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
      aria-hidden="true"
    >
      <path
        d="M4 11l5 5 9-9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Token styles ──────────────────────────────────────────────────────────────

// Dark surface — `--color-pipeline-ink` is #262524 (near-black), used for
// primary CTA buttons; that is the closest "dark surface" token in theme.css.
// White text uses `--color-pipeline-on-dark` (#ffffff).
// Divider: thin line at low-opacity white (matches Figma separator between blocks).

const panelClasses = [
  // Positioning — anchored under the pill, right-aligned.
  "absolute right-4 top-[72px] z-50",
  // Size.
  "w-[360px]",
  // Surface — dark panel.
  "bg-[var(--color-pipeline-ink)]",
  // Typography colour default.
  "text-[color:var(--color-pipeline-on-dark)]",
  // Radius — use pill-l equivalent; `--radius-pipeline-card` is 4px; use 12px
  // via a literal since no larger radius token exists today.
  "rounded-xl",
  // Padding & layout.
  "flex flex-col gap-0",
  // Shadow.
  "shadow-xl",
].join(" ");

const headingClasses = [
  "px-5 pt-5 pb-3",
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-s)]",
  "leading-[var(--text-pipeline-heading-s--line-height)]",
  "font-[var(--font-weight-bold)]",
  "text-[color:var(--color-pipeline-on-dark)]",
].join(" ");

const dividerClasses = "h-px bg-white/10 mx-5";

const walletRowClasses = "flex items-center gap-3 px-5 py-4";

const captionClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-white/60",
].join(" ");

const bodyClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-on-dark)]",
].join(" ");

const disconnectClasses = [
  "w-full flex items-center justify-center",
  "px-5 py-4",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-emphasized)]",
  "text-[color:var(--color-pipeline-on-dark)]",
  // Hover: subtle highlight.
  "hover:bg-white/5 transition-colors",
  "rounded-b-xl",
  // Focus visible.
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40",
].join(" ");

// ── Component ─────────────────────────────────────────────────────────────────

export interface AccountDropdownProps {
  address: `0x${string}`;
  formattedBalance: string;
  onClose: () => void;
  onDisconnect: () => void;
}

export function AccountDropdown({
  address,
  formattedBalance,
  onClose,
  onDisconnect,
}: AccountDropdownProps) {
  const { rootRef, copied, copy, truncated } = useAccountDropdown({
    onClose,
    address,
  });

  // Move focus to the copy button when the panel opens.
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    copyButtonRef.current?.focus();
  }, []);

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Account"
      tabIndex={-1}
      className={panelClasses}
      data-node-id="1506:104728"
    >
      {/* Heading row */}
      <p className={headingClasses}>Account</p>

      <div className={dividerClasses} />

      {/* Wallet address row */}
      <div
        className={walletRowClasses}
        role="group"
        aria-label="Wallet address"
      >
        {/* 40×40 wallet avatar tile */}
        <div
          className={[
            "flex h-10 w-10 shrink-0 items-center justify-center",
            "rounded-[var(--radius-pipeline-card)]",
            "bg-white/10",
            "text-[color:var(--color-pipeline-on-dark)]",
          ].join(" ")}
          aria-hidden="true"
        >
          <WalletGlyph />
        </div>

        {/* Address column */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={captionClasses}>Wallet</span>
          <span className={[bodyClasses, "truncate font-mono"].join(" ")}>
            {truncated}
          </span>
        </div>

        {/* Copy button */}
        <button
          ref={copyButtonRef}
          type="button"
          role="menuitem"
          aria-label="Copy wallet address"
          onClick={copy}
          className={[
            "flex h-8 w-8 shrink-0 items-center justify-center",
            "rounded-[var(--radius-pipeline-card)]",
            "text-[color:var(--color-pipeline-on-dark)]",
            "transition-colors hover:bg-white/10",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40",
          ].join(" ")}
        >
          {copied ? <CheckGlyph /> : <CopyGlyph />}
          <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      <div className={dividerClasses} />

      {/* USDC balance row */}
      <div
        className={[walletRowClasses].join(" ")}
        role="group"
        aria-label="USDC balance"
      >
        <CoinIcon token="usdc" size="lg" aria-hidden />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={captionClasses}>USDC balance</span>
          <span className={bodyClasses}>{formattedBalance}</span>
        </div>
      </div>

      <div className={dividerClasses} />

      {/* Disconnect row */}
      <button
        type="button"
        role="menuitem"
        onClick={onDisconnect}
        className={disconnectClasses}
      >
        Disconnect
      </button>
    </div>
  );
}

export default AccountDropdown;

/**
 * ConnectChooserModal — small modal that lets the user choose which wallet
 * namespace to connect when neither EVM nor Stellar is connected.
 *
 * Shown when the user clicks "Connect Wallet" and no wallet is connected.
 *
 * Props:
 *   - `open`             — whether the modal is visible.
 *   - `onConnectEvm`     — called when the user clicks "Connect EVM".
 *   - `onConnectStellar` — called when the user clicks "Connect Stellar".
 *   - `onDismiss`        — called when the user dismisses (Escape / scrim / ×).
 *
 * Each connect button calls the namespace's `connect()` (passed from TopBar)
 * then dismisses the chooser. The chooser does NOT implement its own terms gate
 * — each `connect()` already routes through the shared chain-agnostic gate.
 *
 * Accessibility: `role="dialog" aria-modal="true"`, focus trap, Escape dismiss,
 * body-scroll lock. Mirrors `FirstConnectionModal` structural patterns.
 */
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ConnectChooserModalProps {
  open: boolean;
  onConnectEvm: () => void;
  onConnectStellar: () => void;
  onDismiss: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConnectChooserModal({
  open,
  onConnectEvm,
  onConnectStellar,
  onDismiss,
}: ConnectChooserModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = "connect-chooser-modal-heading";

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

  const handleConnectEvm = useCallback(() => {
    onConnectEvm();
    onDismiss();
  }, [onConnectEvm, onDismiss]);

  const handleConnectStellar = useCallback(() => {
    onConnectStellar();
    onDismiss();
  }, [onConnectStellar, onDismiss]);

  const handleScrimClick = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const modal = (
    // Fixed overlay (scrim)
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(56,55,53,0.6)" }}
      onClick={handleScrimClick}
      data-testid="connect-chooser-modal-scrim"
    >
      {/* Modal panel — stop propagation so clicks inside don't close the modal */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col gap-6"
        style={{
          width: 380,
          maxWidth: "calc(100vw - 32px)",
          backgroundColor: "#f8f7f6",
          borderRadius: 32,
          padding: 24,
        }}
        data-testid="connect-chooser-modal"
      >
        {/* Close (×) button */}
        <button
          type="button"
          aria-label="Close"
          onClick={onDismiss}
          className={[
            "absolute top-4 right-4",
            "flex h-8 w-8 items-center justify-center",
            "rounded-[var(--radius-pipeline-card)]",
            "text-[color:var(--color-pipeline-ink)]",
            "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
          ].join(" ")}
        >
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
        </button>

        {/* Heading */}
        <h2
          id={headingId}
          className={[
            "m-0 text-left",
            "font-[family-name:var(--font-display)]",
            "text-[length:var(--text-pipeline-heading-m)]",
            "leading-[var(--text-pipeline-heading-m--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          Connect a wallet
        </h2>

        {/* Description */}
        <p
          className={[
            "m-0",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          Choose which wallet to connect. You can connect both.
        </p>

        {/* CTA row */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConnectEvm}
            className={[
              "h-12 flex-1 rounded-[var(--radius-pipeline-button)] px-3",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "font-[var(--font-weight-emphasized)]",
              "bg-[rgba(184,191,190,0.12)]",
              "text-[color:var(--color-pipeline-ink)]",
              "transition-colors hover:bg-[rgba(184,191,190,0.20)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#262524]",
            ].join(" ")}
          >
            Connect EVM
          </button>
          <button
            type="button"
            onClick={handleConnectStellar}
            className={[
              "h-12 flex-1 rounded-[var(--radius-pipeline-button)] px-3",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "font-[var(--font-weight-emphasized)]",
              "bg-[#262524]",
              "text-white",
              "transition-colors hover:bg-[color-mix(in_oklab,#262524_88%,white)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#262524]",
            ].join(" ")}
          >
            Connect Stellar
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default ConnectChooserModal;

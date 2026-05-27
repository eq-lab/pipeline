/**
 * FirstConnectionModal — "Before you continue" jurisdiction self-attestation
 * modal that gates wallet connect.
 *
 * Shown the first time a user clicks Connect Wallet (when
 * `pipeline.wallet.termsAcknowledged.<address>` is not yet set in localStorage).
 *
 * Visual specs (Figma):
 *   - Init state  (toggle off, Continue disabled): node 1572:123328
 *   - Ready state (toggle on, Continue enabled):  node 1582:69059
 *
 * Width: 420px. Max-height: 80vh desktop / 90vh mobile.
 * Scrim:    rgba(56,55,53,0.6)
 * Modal bg: #f8f7f6
 * Padding:  24px
 * Radius:   32px (radius-3xl)
 *
 * Accessibility:
 *   - `role="dialog" aria-modal="true"` on the panel.
 *   - Focus trap: Tab / Shift+Tab cycle among focusable elements inside the panel.
 *   - Escape and scrim click both call `onDismiss`.
 *   - On open, focus moves to the toggle.
 *   - On close, focus is restored to the element that triggered the modal
 *     (handled by the caller via `triggerRef`).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Inline SVG glyphs ──────────────────────────────────────────────────────────

/** Shield-check hero icon — 36×36 for the 72px tinted hero circle. */
function ShieldCheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={36}
      height={36}
      aria-hidden="true"
    >
      <path
        d="M12 2L4 6v6c0 4.97 3.47 9.28 8 10 4.53-.72 8-5.03 8-10V6l-8-4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Forbidden / no-entry circle glyph for bullet 1. */
function ForbiddenGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 4l12 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Magnifier / search glyph for bullet 2. */
function MagnifierGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx="8.5"
        cy="8.5"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M13 13l3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Inline Toggle / Switch ─────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  id: string;
}

/**
 * Inline Toggle Switch — no `@pipeline/ui` primitive yet (see tech-debt-tracker.md).
 *
 * Track colours:
 *   off → rgba(56,55,53,0.18)
 *   on  → #208000 (positive primary)
 * Thumb: white circle.
 */
function Toggle({ checked, onChange, id }: ToggleProps) {
  function handleClick() {
    onChange(!checked);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onChange(!checked);
    }
  }

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#262524]"
      style={{
        // Outer track
        display: "inline-flex",
        alignItems: "center",
        width: 44,
        height: 24,
        borderRadius: 12,
        padding: 2,
        backgroundColor: checked ? "#208000" : "rgba(56,55,53,0.18)",
        transition: "background-color 150ms ease-out",
        border: "none",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "block",
          width: 20,
          height: 20,
          borderRadius: "50%",
          backgroundColor: "#ffffff",
          transform: checked ? "translateX(20px)" : "translateX(0px)",
          transition: "transform 150ms ease-out",
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
        }}
      />
    </button>
  );
}

// ── Focus trap utility ─────────────────────────────────────────────────────────

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="switch"]';

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

// ── Props ──────────────────────────────────────────────────────────────────────

export interface FirstConnectionModalProps {
  /** Whether the modal is currently open. */
  open: boolean;
  /** Called when the user completes the attestation and clicks Continue. */
  onContinue: () => void;
  /** Called when the user dismisses without acknowledging (Disconnect / X / scrim / Escape). */
  onDismiss: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * "Before you continue" modal.
 *
 * Rendered as a portal into `document.body` so it floats above all page content.
 *
 * @example
 * ```tsx
 * <FirstConnectionModal
 *   open={isGateOpen}
 *   onContinue={handleContinue}
 *   onDismiss={handleDismiss}
 * />
 * ```
 */
export function FirstConnectionModal({
  open,
  onContinue,
  onDismiss,
}: FirstConnectionModalProps) {
  const [toggled, setToggled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const toggleId = "first-connection-modal-toggle";
  const headingId = "first-connection-modal-heading";

  // Reset toggle state every time the modal opens.
  useEffect(() => {
    if (open) {
      setToggled(false);
    }
  }, [open]);

  // Focus the toggle on open.
  useEffect(() => {
    if (open) {
      // Let the DOM paint before moving focus.
      const id = setTimeout(() => {
        toggleRef.current?.focus();
      }, 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Escape key closes the modal.
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

  // Prevent body scroll while the modal is open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleScrimClick = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  const handleContinue = useCallback(() => {
    if (!toggled) return;
    onContinue();
  }, [toggled, onContinue]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const modal = (
    // Fixed overlay (scrim)
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(56,55,53,0.6)" }}
      onClick={handleScrimClick}
      data-testid="first-connection-modal-scrim"
    >
      {/* Modal panel — stop propagation so clicks inside don't close the modal */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col gap-6 overflow-y-auto"
        style={{
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "min(80vh, 90dvh)",
          backgroundColor: "#f8f7f6",
          borderRadius: 32,
          padding: 24,
        }}
        data-node-id="1572:123328"
        data-testid="first-connection-modal"
      >
        {/* Close (X) button — top-right corner */}
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
          {/* ×  */}
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

        {/* Hero icon — 72×72 tinted circle */}
        <div className="flex justify-start">
          <div
            className="inline-flex shrink-0 items-center justify-center rounded-full"
            style={{
              width: 72,
              height: 72,
              backgroundColor: "rgba(184,191,190,0.12)",
              color: "var(--color-pipeline-ink)",
            }}
            aria-hidden="true"
          >
            <ShieldCheckGlyph />
          </div>
        </div>

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
          Before you continue
        </h2>

        {/* Bullet list */}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <li className="flex items-start gap-3">
            <span
              className="mt-0.5 text-[color:var(--color-pipeline-ink)]"
              aria-hidden="true"
            >
              <ForbiddenGlyph />
            </span>
            <span
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "text-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
            >
              Pipeline unavailable to US persons or restricted jurisdictions
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span
              className="mt-0.5 text-[color:var(--color-pipeline-ink)]"
              aria-hidden="true"
            >
              <MagnifierGlyph />
            </span>
            <span
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "text-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
            >
              Wallets are screened for sanctions and high-risk activity
            </span>
          </li>
        </ul>

        {/* Toggle + label */}
        <div className="flex w-full items-center justify-between gap-3">
          <label
            htmlFor={toggleId}
            className={[
              "cursor-pointer select-none",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "text-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            I&apos;m not a US person and not located in a restricted
            jurisdiction
          </label>
          {/*
           * The Toggle button is the first focusable element and receives focus
           * on open. We hold a ref here so the useEffect above can call focus().
           * We pass a prop `id` for the label association, but the ref needs to
           * reach the inner <button>; we achieve this by wrapping and using
           * a ref forwarded into the Toggle.
           */}
          <span
            ref={(el) => {
              // Assign toggleRef to the <button role="switch"> inside the wrapper.
              if (el) {
                const btn =
                  el.querySelector<HTMLButtonElement>('[role="switch"]');
                if (btn) {
                  (
                    toggleRef as React.MutableRefObject<HTMLButtonElement | null>
                  ).current = btn;
                }
              }
            }}
          >
            <Toggle id={toggleId} checked={toggled} onChange={setToggled} />
          </span>
        </div>

        {/* CTAs */}
        <div className="flex gap-2">
          {/* Disconnect — left */}
          <button
            type="button"
            onClick={onDismiss}
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
            Disconnect
          </button>

          {/* Continue — right */}
          <button
            type="button"
            onClick={handleContinue}
            disabled={!toggled}
            aria-disabled={!toggled}
            data-node-id="1582:69059"
            className={[
              "h-12 flex-1 rounded-[var(--radius-pipeline-button)] px-3",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "font-[var(--font-weight-emphasized)]",
              "transition-opacity duration-150 ease-out",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#262524]",
              toggled
                ? [
                    "cursor-pointer",
                    "bg-[#262524]",
                    "text-white",
                    "hover:bg-[color-mix(in_oklab,#262524_88%,white)]",
                  ].join(" ")
                : [
                    "cursor-not-allowed",
                    "bg-[#262524]",
                    "text-white",
                    "opacity-[0.32]",
                  ].join(" "),
            ].join(" ")}
          >
            Continue
          </button>
        </div>

        {/* Footer */}
        <p
          className={[
            "m-0 text-center",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          By continuing, you agree to our{" "}
          <a
            href="#"
            className={[
              "text-[color:var(--color-pipeline-ink)]",
              "underline underline-offset-2",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
            ].join(" ")}
          >
            Terms of Service
          </a>
        </p>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default FirstConnectionModal;

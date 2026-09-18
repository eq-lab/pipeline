// spec: docs/frontend/auth-components.md#authmodalshell (two-pane layout lifted
// verbatim from ConnectWalletModal; Figma nodes 8550:10210 / 8550:10546).
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Logo } from "@pipeline/ui";
import heroUrl from "@/assets/connect-hero-ship.webp?url";

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

// ── Back-arrow icon ───────────────────────────────────────────────────────────

function ArrowLeftIcon() {
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
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.46967 11.4697C3.17678 11.7626 3.17678 12.2374 3.46967 12.5303L9.46967 18.5303C9.76256 18.8232 10.2374 18.8232 10.5303 18.5303C10.8232 18.2374 10.8232 17.7626 10.5303 17.4697L5.81066 12.75H20C20.4142 12.75 20.75 12.4142 20.75 12C20.75 11.5858 20.4142 11.25 20 11.25H5.81066L10.5303 6.53033C10.8232 6.23744 10.8232 5.76256 10.5303 5.46967C10.2374 5.17678 9.76256 5.17678 9.46967 5.46967L3.46967 11.4697Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ── Right image panel (desktop only) ─────────────────────────────────────────

function RightImagePanel() {
  return (
    <div
      className="relative hidden h-full flex-1 overflow-hidden lg:flex lg:flex-col lg:gap-6 lg:p-12"
      aria-hidden="true"
    >
      <img
        src={heroUrl}
        alt=""
        className="absolute inset-0 size-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.10) 55%, rgba(0,0,0,0.0) 100%)",
        }}
      />

      <div className="relative z-10 flex flex-col gap-6">
        <div className="shrink-0">
          <Logo width={116} style={{ color: "#fff" }} />
        </div>

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

export interface AuthModalShellProps {
  open: boolean;
  onDismiss: () => void;
  heading: string;
  headingId: string;
  testId: string;
  children: React.ReactNode;
  description?: string;
  showImagePanel?: boolean;
  showCloseButton?: boolean;
  onBack?: () => void;
  align?: "start" | "center";
  stepLabel?: { current: number; total: number };
}

// ── Shell component ───────────────────────────────────────────────────────────

export function AuthModalShell({
  open,
  onDismiss,
  heading,
  headingId,
  testId,
  children,
  description,
  showImagePanel = true,
  showCloseButton = true,
  onBack,
  align = "start",
  stepLabel,
}: AuthModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);

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
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onDismiss]);

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

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex"
      data-testid={`${testId}-overlay`}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={[
          "relative flex h-full w-full overflow-hidden",
          "bg-[var(--color-pipeline-paper)]",
        ].join(" ")}
        data-testid={testId}
      >
        <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto px-6 py-10 lg:px-8 lg:py-12">
          <div
            className={[
              "flex w-full max-w-[400px] flex-col gap-6",
              align === "center" ? "my-auto" : "",
            ].join(" ")}
          >
            <div className="flex flex-col gap-2">
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
                {heading}
              </h2>

              {description ? (
                <p
                  className={[
                    "m-0",
                    "font-[family-name:var(--font-body)]",
                    "text-[length:var(--text-pipeline-body)]",
                    "leading-[var(--text-pipeline-body--line-height)]",
                    "text-[color:var(--color-pipeline-ink)]",
                  ].join(" ")}
                >
                  {description}
                </p>
              ) : null}
            </div>

            {children}
          </div>
        </div>

        {showImagePanel !== false ? <RightImagePanel /> : null}

        {showCloseButton !== false ? (
          <button
            type="button"
            aria-label="Close"
            onClick={onDismiss}
            className={[
              "absolute top-4 right-4 z-10",
              "flex h-8 w-8 items-center justify-center",
              "rounded-[var(--radius-pipeline-card)]",
              "text-[color:var(--color-pipeline-ink)]",
              "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
            ].join(" ")}
          >
            <CloseIcon />
          </button>
        ) : null}

        {onBack ? (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className={[
              "absolute top-4 left-4 z-10",
              "flex h-8 w-8 items-center justify-center",
              "rounded-[var(--radius-pipeline-card)]",
              "text-[color:var(--color-pipeline-ink)]",
              "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
            ].join(" ")}
          >
            <ArrowLeftIcon />
          </button>
        ) : null}

        {stepLabel ? (
          <div className="absolute top-4 left-4 z-10 flex h-10 items-center px-4 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] font-[var(--font-weight-emphasized)] text-[color:var(--color-pipeline-ink)]">
            <span>
              Step {stepLabel.current}
              <span className="text-[color:var(--color-pipeline-ink-muted)]">
                /{stepLabel.total}
              </span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default AuthModalShell;

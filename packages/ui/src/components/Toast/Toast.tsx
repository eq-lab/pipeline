import React from "react";
import { Button } from "../Button/Button";

/**
 * Toast — Pipeline UI notification surface with tone-mapped fill and optional action.
 * spec: docs/frontend/ui-components.md#toast
 */

export type ToastTone = "neutral" | "success" | "danger" | "pending";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** Tone controls background color and default icon. Default: "neutral". */
  tone?: ToastTone;
  /** Title text shown next to the leading icon. */
  title: React.ReactNode;
  /** Optional right-aligned action button. */
  action?: ToastAction;
  /** Optional leading icon override; defaults per tone. */
  icon?: React.ReactNode;
  onDismiss?: () => void;
}

// SVG icons inlined so the component is self-contained without an asset bundler.

const CheckIcon = (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className="size-[20px] shrink-0"
  >
    <path
      d="M4.5 10.5L8 14L15.5 6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Viewbox 16.6667 × 16.6667 matches the existing icon assets in packages/ui/src/assets/icons/.
const CheckCircleIcon = (
  <svg
    viewBox="0 0 16.6667 16.6667"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className="size-[20px] shrink-0"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.33333 0C12.9357 0 16.6667 3.73096 16.6667 8.33333C16.6667 12.9357 12.9357 16.6667 8.33333 16.6667C3.73096 16.6667 0 12.9357 0 8.33333C0 3.73096 3.73096 0 8.33333 0ZM12.1086 5.80811C11.8645 5.56403 11.4688 5.56403 11.2248 5.80811L7.08333 9.94954L5.44189 8.30811C5.19782 8.06403 4.80218 8.06403 4.55811 8.30811C4.31403 8.55218 4.31403 8.94782 4.55811 9.19189L6.64144 11.2752C6.88552 11.5193 7.28115 11.5193 7.52523 11.2752L12.1086 6.69189C12.3526 6.44782 12.3526 6.05218 12.1086 5.80811Z"
      fill="currentColor"
    />
  </svg>
);

const ClockPendingIcon = (
  <svg
    viewBox="0 0 16.6667 16.6667"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className="size-[20px] shrink-0"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.33333 0C12.9357 0 16.6667 3.73096 16.6667 8.33333C16.6667 12.9357 12.9357 16.6667 8.33333 16.6667C3.73096 16.6667 0 12.9357 0 8.33333C0 3.73096 3.73096 0 8.33333 0ZM8.33333 3.59782C7.98816 3.59782 7.70833 3.87764 7.70833 4.22282V8.57585L4.86165 10.4736C4.57457 10.6651 4.49688 11.0532 4.68831 11.3403C4.8798 11.6273 5.2679 11.705 5.55501 11.5137L8.68001 9.43034C8.85379 9.31448 8.95822 9.11916 8.95833 8.91032V4.22282C8.95833 3.87764 8.67851 3.59782 8.33333 3.59782Z"
      fill="currentColor"
    />
  </svg>
);

const toneBackground: Record<ToastTone, string> = {
  neutral: "bg-[var(--color-pipeline-ink)]",
  success: "bg-[var(--color-pipeline-positive-primary)]",
  danger: "bg-[var(--color-pipeline-danger)]",
  // ink-muted is rgba — Tailwind can't apply the token via bg-, so the raw value is inlined
  pending: "bg-[rgb(56_55_53_/_0.6)]",
};

export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  function Toast(
    { tone = "neutral", title, action, icon, onDismiss, className, ...rest },
    ref,
  ) {
    const isDanger = tone === "danger";
    const role = isDanger ? "alert" : "status";
    const ariaLive = isDanger ? "assertive" : "polite";

    const defaultIcon =
      tone === "pending"
        ? ClockPendingIcon
        : tone === "success"
          ? CheckIcon
          : CheckCircleIcon;
    const leadingIcon = icon ?? defaultIcon;

    const bgClass = toneBackground[tone];

    const containerClasses = [
      "inline-flex items-center p-4",
      "rounded-[var(--radius-pipeline-card)]",
      "shadow-sm",
      bgClass,
      "text-[color:var(--color-pipeline-on-dark)]",
      "font-[family-name:var(--font-body)]",
      "text-[length:var(--text-pipeline-body)]",
      "leading-[var(--text-pipeline-body--line-height)]",
      "font-[var(--font-weight-regular)]",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        ref={ref}
        role={role}
        aria-live={ariaLive}
        className={containerClasses}
        {...rest}
      >
        <span className="shrink-0 text-[color:var(--color-pipeline-on-dark)]">
          {leadingIcon}
        </span>

        <span className="shrink-0 px-2 whitespace-nowrap">{title}</span>

        {action && (
          <Button variant="toast-action" onClick={action.onClick}>
            {action.label}
          </Button>
        )}

        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            data-testid="toast-dismiss"
            onClick={onDismiss}
            className={[
              "ml-2 flex size-6 shrink-0 items-center justify-center",
              "rounded-[var(--radius-pipeline-button)]",
              "text-[color:var(--color-pipeline-on-dark)]",
              "transition-opacity hover:opacity-70",
              "focus-visible:outline focus-visible:outline-2",
              "focus-visible:outline-[color:var(--color-pipeline-on-dark)]/40",
            ].join(" ")}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width={14}
              height={14}
              aria-hidden="true"
            >
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
    );
  },
);

Toast.displayName = "Toast";

export default Toast;

// spec: docs/frontend/account-page.md#accountstatusbanner
import React from "react";
import { Button } from "@pipeline/ui";

export function ShieldCheckIcon() {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.6185 2.87493C15.8714 2.83838 16.1286 2.83838 16.3815 2.87493C16.6667 2.91614 16.9444 3.02122 17.4987 3.2291L23.8984 5.62884C24.8963 6.00304 25.3953 6.19018 25.763 6.51425C26.0879 6.80058 26.3382 7.16161 26.4922 7.56634C26.6665 8.02451 26.6667 8.55762 26.6667 9.62363V12.0781C26.6667 15.9105 26.6661 17.8267 26.1315 19.5572C25.6423 21.1408 24.8309 22.6064 23.7474 23.8606C22.5632 25.2312 20.9376 26.2473 17.6875 28.2786C17.0805 28.658 16.7769 28.8477 16.4518 28.9231C16.1545 28.992 15.8455 28.992 15.5482 28.9231C15.2231 28.8477 14.9195 28.658 14.3125 28.2786C11.0624 26.2473 9.43683 25.2312 8.2526 23.8606C7.16908 22.6064 6.35771 21.1408 5.86849 19.5572C5.33393 17.8267 5.33333 15.9105 5.33333 12.0781V9.62363C5.33333 8.55762 5.33347 8.02451 5.50781 7.56634C5.66182 7.16161 5.9121 6.80058 6.23698 6.51425C6.60471 6.19018 7.10369 6.00304 8.10156 5.62884L14.5013 3.2291C15.0556 3.02122 15.3333 2.91614 15.6185 2.87493ZM22.0404 11.9596C21.6499 11.5691 21.0168 11.5691 20.6263 11.9596L14 18.5859L11.3737 15.9596C10.9832 15.5691 10.3501 15.5691 9.95964 15.9596C9.56912 16.3501 9.56915 16.9831 9.95964 17.3736L13.293 20.707C13.6835 21.0975 14.3165 21.0975 14.707 20.707L22.0404 13.3736C22.4309 12.9831 22.4309 12.3501 22.0404 11.9596Z"
      />
    </svg>
  );
}

export function WarningTriangleIcon() {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.1861 4.84017C15.7039 4.60962 16.2959 4.60962 16.8137 4.84017C17.4071 5.10462 17.8616 5.8919 18.7707 7.46647L27.0845 21.8662C27.9937 23.441 28.4491 24.2291 28.3814 24.8753C28.3221 25.439 28.0261 25.951 27.5676 26.2842C27.0419 26.6661 26.1325 26.667 24.3137 26.667H7.68608C5.86727 26.667 4.95789 26.6661 4.43217 26.2842C3.97375 25.951 3.67761 25.4389 3.61837 24.8753C3.55072 24.2291 4.00603 23.441 4.91524 21.8662L13.229 7.46647C14.1381 5.89202 14.5927 5.10472 15.1861 4.84017ZM15.9999 20.667C15.2636 20.6671 14.6665 21.264 14.6665 22.0003C14.6667 22.7365 15.2636 23.3336 15.9999 23.3337C16.7362 23.3337 17.3331 22.7366 17.3332 22.0003C17.3332 21.2639 16.7363 20.667 15.9999 20.667ZM15.9999 11.3337C15.2636 11.3337 14.6665 11.9307 14.6665 12.667V17.3337C14.6667 18.0699 15.2636 18.6669 15.9999 18.667C16.7362 18.667 17.3331 18.0699 17.3332 17.3337V12.667C17.3332 11.9306 16.7363 11.3337 15.9999 11.3337Z"
      />
    </svg>
  );
}

export interface AccountStatusBannerProps {
  tone: "warning" | "negative";
  icon: React.ReactNode;
  iconTile?: boolean;
  title: React.ReactNode;
  caption: string;
  action?: { label: string; onClick: () => void };
}

export function AccountStatusBanner({
  tone,
  icon,
  iconTile = false,
  title,
  caption,
  action,
}: AccountStatusBannerProps) {
  const composed = [
    "flex h-[72px] w-full items-center gap-3 p-4",
    "rounded-[var(--radius-pipeline-card)]",
    "border border-[color:var(--color-pipeline-line)]",
    tone === "warning"
      ? "bg-[color:var(--color-pipeline-promo)]"
      : "bg-[color:var(--color-pipeline-negative-secondary)]",
  ].join(" ");

  const nodeId =
    tone === "warning" ? "6701:98155" : iconTile ? "6701:98040" : "6701:98000";

  return (
    <div className={composed} role="status" data-node-id={nodeId}>
      {iconTile ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-fill-muted)] text-[color:var(--color-pipeline-ink)]">
          {icon}
        </div>
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center text-[color:var(--color-pipeline-ink)]">
          {icon}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          {title}
        </p>
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          {caption}
        </p>
      </div>

      {action && (
        <Button variant="secondary" size="compact" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export default AccountStatusBanner;

// spec: docs/frontend/account-page.md#accountlistrow
import React from "react";

export interface AccountListRowProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  "title"
> {
  leading: React.ReactNode;
  caption: string;
  title: string;
  trailing?: React.ReactNode;
  variant?: "card" | "plain";
  onActivate?: () => void;
}

export function AccountListRow({
  leading,
  caption,
  title,
  trailing,
  variant = "card",
  onActivate,
  className,
  ...rest
}: AccountListRowProps) {
  const composed = [
    "flex w-full items-center gap-3",
    "rounded-[var(--radius-pipeline-card)]",
    variant === "card" ? "bg-[color:var(--color-pipeline-surface)] p-4" : "p-2",
    onActivate
      ? [
          "text-left",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "focus-visible:ring-[var(--color-pipeline-brand)]",
        ].join(" ")
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span
          className={[
            "block truncate",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          {caption}
        </span>
        <span
          className={[
            "block truncate",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          {title}
        </span>
      </span>
      {trailing}
    </>
  );

  if (onActivate) {
    return (
      <button type="button" onClick={onActivate} className={composed} {...rest}>
        {content}
      </button>
    );
  }

  return (
    <div className={composed} {...rest}>
      {content}
    </div>
  );
}

export default AccountListRow;

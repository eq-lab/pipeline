// spec: docs/frontend/account-page.md#accountlistrow
import React from "react";

export interface AccountListRowProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  leading: React.ReactNode;
  caption: string;
  title: string;
  trailing?: React.ReactNode;
  variant?: "card" | "plain";
}

export function AccountListRow({
  leading,
  caption,
  title,
  trailing,
  variant = "card",
  className,
  ...rest
}: AccountListRowProps) {
  const composed = [
    "flex w-full items-center gap-3",
    "rounded-[var(--radius-pipeline-card)]",
    variant === "card" ? "bg-[color:var(--color-pipeline-surface)] p-4" : "p-2",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={composed} {...rest}>
      {leading}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p
          className={[
            "truncate",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          {caption}
        </p>
        <p
          className={[
            "truncate",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          {title}
        </p>
      </div>
      {trailing}
    </div>
  );
}

export default AccountListRow;

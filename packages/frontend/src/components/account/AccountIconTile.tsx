// spec: docs/frontend/account-page.md#accounticontile
import React from "react";

export interface AccountIconTileProps {
  children: React.ReactNode;
  className?: string;
}

export function AccountIconTile({ children, className }: AccountIconTileProps) {
  const composed = [
    "flex size-10 shrink-0 items-center justify-center",
    "rounded-[var(--radius-pipeline-card)]",
    "bg-[color:var(--color-pipeline-brand-secondary)]",
    "text-[color:var(--color-pipeline-ink)]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={composed} aria-hidden="true">
      {children}
    </div>
  );
}

export default AccountIconTile;

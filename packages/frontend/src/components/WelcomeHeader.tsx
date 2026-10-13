// spec: docs/frontend/dashboard-components.md#welcomeheader
import React from "react";
import { HomeStatsStrip } from "./HomeStatsStrip";

export interface WelcomeHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  isReturning?: boolean;
}

const rootClasses = [
  "flex w-full gap-12 items-end justify-center",
  "px-0",
].join(" ");

const headingClasses = [
  "flex-1 min-w-0",
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[32px] leading-[36px]",
  "md:text-[length:var(--text-pipeline-title)] md:leading-[var(--text-pipeline-title--line-height)]",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "whitespace-nowrap",
].join(" ");

export function WelcomeHeader({
  className,
  isReturning = false,
  ...rest
}: WelcomeHeaderProps) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  return (
    <div className={composed} {...rest}>
      <h1 className={headingClasses} data-testid="home-welcome-heading">
        {isReturning ? "Welcome back" : "Welcome"}
      </h1>

      <HomeStatsStrip className="hidden md:flex" />
    </div>
  );
}

export default WelcomeHeader;

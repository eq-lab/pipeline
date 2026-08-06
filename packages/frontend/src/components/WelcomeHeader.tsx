import React from "react";
import { HomeStatsStrip } from "./HomeStatsStrip";

// spec: docs/frontend/dashboard-components.md#welcomeheader (responsive heading/greeting, Figma frame 1497:94558).

export interface WelcomeHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * When `true` the mobile heading reads "Welcome back" instead of "Welcome".
   * Has no effect at `md` and above — the desktop heading always reads "Welcome".
   * Defaults to `false` (disconnected).
   */
  isConnected?: boolean;
}

const rootClasses = [
  "flex w-full gap-12 items-end justify-center",
  "px-0",
].join(" ");

// spec: docs/frontend/dashboard-components.md#welcomeheader (heading size by breakpoint, Figma frames 1989:8292 / 1497:94558).
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
  isConnected = false,
  ...rest
}: WelcomeHeaderProps) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  return (
    <div className={composed} {...rest}>
      <h1 className={headingClasses} data-testid="home-welcome-heading">
        {/* Both variants are rendered and toggled with Tailwind (not a JS
            conditional) so the DOM diff is purely class-driven and screen
            readers pick up the right string at each breakpoint. */}
        <span className="md:hidden">
          {isConnected ? "Welcome back" : "Welcome"}
        </span>
        <span className="hidden md:inline">Welcome</span>
      </h1>

      <HomeStatsStrip className="hidden md:flex" />
    </div>
  );
}

export default WelcomeHeader;

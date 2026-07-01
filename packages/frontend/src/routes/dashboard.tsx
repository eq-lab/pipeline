import { createFileRoute } from "@tanstack/react-router";
import { BalanceSheetPanel } from "@/components/dashboard/BalanceSheetPanel";
import { DeploymentMonitorPanel } from "@/components/dashboard/DeploymentMonitorPanel";
import { WithdrawalQueuePanel } from "@/components/dashboard/WithdrawalQueuePanel";
import { YieldHistoryPanel } from "@/components/dashboard/YieldHistoryPanel";

/**
 * Protocol Dashboard route (`/dashboard`) — Issues #716, #728.
 *
 * Hosts the four panel slots in a full-width single-column stack at every
 * viewport width. The page is protocol-wide, NOT wallet-gated — it renders
 * fully with no wallet connected (it pulls no wallet hooks at all).
 *
 * Entry point: reached from the home page (`/`) "Current APY" external-link
 * icon (`HomeStatsStrip`, Figma node `1497:94564`), not a `TopBar` slot.
 *
 * Layout (Issue #728 — matches Figma `3283-12098`):
 *   - Centred content column capped at `max-w-[1200px]` (matches the desktop
 *     frame's 1200px content width), `px-8` side padding (32px, the frame's
 *     inner gutter) and `py-8` vertical padding.
 *   - All viewports: full-width single-column stack (`grid-cols-1`) so every
 *     panel spans the full ~1136px content width. `gap-6` on mobile stepping
 *     to `md:gap-8` (32px) at desktop, matching the Figma frame section
 *     spacing. The previous `md:grid-cols-2` 2×2 grid was a #716 shell
 *     placeholder — Figma `3283-12098` shows a full-width vertical stack.
 *   - Source order (Figma `3283-12098`): Yield History (no section heading)
 *     → Balance Sheet → Loan Book (DeploymentMonitor) → Withdrawal Queue.
 *     This matches Figma section order per coordinator decision for #720.
 *
 * Token discipline (FRONTEND.md): no raw hex/font names; all colors and
 * typography flow through `@pipeline/ui` primitives and theme-token utilities.
 * The `max-w`/`min-h` pixel hints are layout sizing, not design tokens.
 *
 * Figma reference:
 *   Desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-12098&m=dev
 *   Responsive: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72387&m=dev
 */

// Page title — display serif, heading-l (48px) on desktop stepping down to
// heading-m (28px) below md, matching the home page's responsive type scale.
const titleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-l)]",
  "md:leading-[var(--text-pipeline-heading-l--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

function Dashboard() {
  return (
    <div
      data-testid="dashboard-page-root"
      data-node-id="3283:12098"
      className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]"
    >
      <main
        data-testid="dashboard-main"
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-8 py-8"
      >
        <h1 className={titleClasses} data-testid="dashboard-title">
          Protocol Dashboard
        </h1>

        {/*
         * Full-width single-column stack at all viewports — matches Figma 3283-12098.
         * Section order per Figma parent frame:
         *   1. Yield History (Charts/Yield) — Panel D, no section heading (Figma 3283:67619).
         *   2. Balance Sheet — Panel A.
         *   3. Loan Book (DeploymentMonitor) — Panel B.
         *   4. Withdrawal Queue — Panel C.
         */}
        <div
          data-testid="dashboard-grid"
          className="grid grid-cols-1 gap-6 md:gap-8"
        >
          <YieldHistoryPanel />
          <BalanceSheetPanel />
          <DeploymentMonitorPanel />
          <WithdrawalQueuePanel />
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

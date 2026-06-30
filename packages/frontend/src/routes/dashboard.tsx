import { createFileRoute } from "@tanstack/react-router";
import { BalanceSheetPanel } from "@/components/dashboard/BalanceSheetPanel";
import { DeploymentMonitorPanel } from "@/components/dashboard/DeploymentMonitorPanel";
import { WithdrawalQueuePanel } from "@/components/dashboard/WithdrawalQueuePanel";
import { YieldHistoryPanel } from "@/components/dashboard/YieldHistoryPanel";

/**
 * Protocol Dashboard route (`/dashboard`) — Issue #716.
 *
 * Stands up the route + the responsive shell hosting four panel slots. Panels
 * are **placeholders** here ("Coming soon"); real data wiring lands in
 * follow-up sub-issues of epic #712. The page is protocol-wide, NOT
 * wallet-gated — it renders fully with no wallet connected (it pulls no wallet
 * hooks at all).
 *
 * Entry point: reached from the home page (`/`) "Current APY" external-link
 * icon (`HomeStatsStrip`, Figma node `1497:94564`), not a `TopBar` slot.
 *
 * Layout:
 *   - Centred content column capped at `max-w-[1200px]` (matches the desktop
 *     frame's 1200px content width), `px-8` side padding (32px, the frame's
 *     inner gutter) and `py-8` vertical padding.
 *   - Desktop (`md+`): two-column grid (`md:grid-cols-2`) with `md:gap-8`
 *     (32px), the multi-column treatment the issue calls for.
 *   - Mobile (below `md`): single-column stack (`grid-cols-1`) with `gap-6`.
 *   Panels render in A→B→C→D reading order. Exact column structure, gaps and
 *   mobile panel ordering against the responsive frame are reconciled when the
 *   real panels land and verified in the epic #712 QA pass (frames
 *   `3283-12098` desktop, `3283-72387` responsive).
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

        {/* Responsive panel grid: single column on mobile, two columns at md+. */}
        <div
          data-testid="dashboard-grid"
          className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8"
        >
          <BalanceSheetPanel />
          <DeploymentMonitorPanel />
          <WithdrawalQueuePanel />
          <YieldHistoryPanel />
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

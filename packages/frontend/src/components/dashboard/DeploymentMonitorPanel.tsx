/**
 * DeploymentMonitorPanel — Protocol Dashboard Panel B: Loan Book.
 *
 * Wires the `useLoanBook` hook via a co-located `useDeploymentMonitorPanel`
 * logic hook (FRONTEND.md rule 2). The view here is JSX-only; all formatting
 * and state-machine logic lives in `useDeploymentMonitorPanel.ts`.
 *
 * Panel title is "Loan Book" (Figma: node 3283:14431 — confirmed in issue #717).
 * The `data-testid` and `data-node-id` attributes are preserved as stable
 * anchors for tests and Figma QA tooling.
 *
 * Includes the Active Loans / In Origination tab bar (Figma node 3283:14480).
 * The Active Loans tab shows a live count badge (loans.length from the API).
 * The In Origination tab is visibly disabled — no origination endpoint is
 * served yet (deferred per #717); it renders no count badge until the endpoint
 * exists.
 *
 * Figma:
 *   Desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431
 *   Mobile:  https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72323
 */
import { PanelContainer } from "./PanelContainer";
import { LoanBookSummary } from "./LoanBookSummary";
import { LoanBookTable } from "./LoanBookTable";
import { useDeploymentMonitorPanel } from "./useDeploymentMonitorPanel";

// ── Tab bar ───────────────────────────────────────────────────────────────────

// Figma node 3283:14480 — compact segmented control:
// - Container: muted fill track (--color-pipeline-fill-muted), 2px padding,
//   6px radius (--radius-pipeline-card-sm).
// - Selected tab: white chip (--color-pipeline-surface), 32px height, 6px
//   horizontal padding, 4px radius (--radius-pipeline-card), caption-size
//   Medium (500) ink label.
// - Unselected/disabled tab: transparent bg, same geometry, Regular (400)
//   ink-muted label, cursor-not-allowed.
// - Badge: muted fill, 4px radius, caption-size Regular ink-muted text,
//   min-width 20px, horizontal padding 4px.
//   Note: Figma also specifies a backdrop-blur ~16px effect on the badge;
//   omitted — no blur token exists and it has no visible effect on the flat
//   panel background.

const tabSharedClasses = [
  "inline-flex items-center justify-center gap-1",
  "h-8 px-1.5",
  "rounded-[var(--radius-pipeline-card,4px)]",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption,12px)]",
  "leading-[var(--text-pipeline-caption--line-height,16px)]",
].join(" ");

const activeTabClasses = [
  tabSharedClasses,
  "bg-[color:var(--color-pipeline-surface)]",
  "text-[color:var(--color-pipeline-ink)]",
  "font-medium",
  "cursor-default",
].join(" ");

const disabledTabClasses = [
  tabSharedClasses,
  "text-[color:var(--color-pipeline-ink-muted)]",
  "font-normal",
  "cursor-not-allowed",
  "opacity-50",
].join(" ");

const badgeClasses = [
  "inline-flex items-center justify-center",
  "min-w-5 px-1 py-0.5",
  "rounded-[var(--radius-pipeline-card,4px)]",
  "bg-[color:var(--color-pipeline-fill-muted)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption,12px)]",
  "leading-[var(--text-pipeline-caption--line-height,16px)]",
].join(" ");

interface LoanBookTabBarProps {
  activeLoansCount: number;
}

function LoanBookTabBar({ activeLoansCount }: LoanBookTabBarProps) {
  return (
    <div
      className="flex items-start p-0.5 rounded-[var(--radius-pipeline-card-sm,6px)] bg-[color:var(--color-pipeline-fill-muted)] w-fit"
      data-testid="loan-book-tab-bar"
      role="tablist"
    >
      <div
        className={activeTabClasses}
        role="tab"
        aria-selected="true"
        data-testid="loan-book-tab-active-loans"
      >
        Active Loans
        <span className={badgeClasses} data-testid="loan-book-tab-active-loans-count">
          {activeLoansCount}
        </span>
      </div>
      <div
        className={disabledTabClasses}
        role="tab"
        aria-selected="false"
        aria-disabled="true"
        data-testid="loan-book-tab-in-origination"
      >
        In Origination
        {/* No count badge — origination endpoint is deferred per #717; no fabricated number. */}
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function DeploymentMonitorPanel() {
  const { state, summary, rows, activeLoansCount, errorMessage, refetch } =
    useDeploymentMonitorPanel();

  return (
    <PanelContainer
      title="Loan Book"
      state={state}
      onRetry={refetch}
      errorMessage={errorMessage}
      data-testid="dashboard-panel-deployment-monitor"
      data-node-id="3283:14431"
    >
      {/* Tab bar is always rendered in the ready state */}
      <div className="flex flex-col gap-4">
        <LoanBookTabBar activeLoansCount={activeLoansCount} />
        <LoanBookSummary
          totalDeployed={summary.totalDeployed}
          totalCollateral={summary.totalCollateral}
          seniorDebtCoverage={summary.seniorDebtCoverage}
          avgYield={summary.avgYield}
          avgDuration={summary.avgDuration}
        />
        <LoanBookTable rows={rows} />
      </div>
    </PanelContainer>
  );
}

export default DeploymentMonitorPanel;

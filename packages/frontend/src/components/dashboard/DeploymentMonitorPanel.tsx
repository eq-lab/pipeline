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
 * Includes the Active Loans / In Origination tab bar, with In Origination
 * visibly disabled — no origination endpoint is served yet; the tab will be
 * wired in a follow-up issue.
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

// Figma: "Active Loans · 7 / In Origination · 3" tab bar (node 3283:14480).
// Only "Active Loans" is functional; "In Origination" is disabled until the
// trustee submissions endpoint is wired (follow-up issue).

const activeTabClasses = [
  "inline-flex items-center gap-1.5 px-3 py-1.5",
  "rounded-[var(--radius-pipeline-pill,9999px)]",
  "bg-[color:var(--color-pipeline-ink)]",
  "font-[family-name:var(--font-text)]",
  "font-medium",
  "text-[length:var(--text-pipeline-body-s,14px)]",
  "leading-[var(--text-pipeline-body-s--line-height,20px)]",
  "text-[color:var(--color-pipeline-paper)]",
  "cursor-default",
].join(" ");

const disabledTabClasses = [
  "inline-flex items-center gap-1.5 px-3 py-1.5",
  "rounded-[var(--radius-pipeline-pill,9999px)]",
  "font-[family-name:var(--font-text)]",
  "font-medium",
  "text-[length:var(--text-pipeline-body-s,14px)]",
  "leading-[var(--text-pipeline-body-s--line-height,20px)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "cursor-not-allowed",
  "opacity-50",
].join(" ");

function LoanBookTabBar() {
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-[var(--radius-pipeline-pill,9999px)] bg-[color:var(--color-pipeline-surface-subtle,rgba(50,56,55,0.06))] w-fit"
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
      </div>
      <div
        className={disabledTabClasses}
        role="tab"
        aria-selected="false"
        aria-disabled="true"
        data-testid="loan-book-tab-in-origination"
      >
        In Origination
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function DeploymentMonitorPanel() {
  const { state, summary, rows, errorMessage, refetch } =
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
        <LoanBookTabBar />
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

/**
 * DeploymentMonitorPanel — Protocol Dashboard Panel B: Loan Book.
 *
 * spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel
 * (panel/tab-bar behavior, Figma bindings, tab styling).
 */
import { PanelContainer } from "./PanelContainer";
import { LoanBookSummary } from "./LoanBookSummary";
import { LoanBookTable } from "./LoanBookTable";
import { OriginationTable } from "./OriginationTable";
import { PanelLoading } from "./PanelLoading";
import { PanelError } from "./PanelError";
import { PanelEmpty } from "./PanelEmpty";
import {
  useDeploymentMonitorPanel,
  type LoanBookTab,
} from "./useDeploymentMonitorPanel";

// ── Tab bar ───────────────────────────────────────────────────────────────────
// spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel (tab bar Figma tokens/behavior)
const tabSharedClasses = [
  "flex flex-1 md:flex-none items-center justify-center gap-0",
  "h-8 min-w-8 px-1.5",
  "rounded-[var(--radius-pipeline-card)]",
  "font-[family-name:var(--font-body)]",
  "font-medium",
  "text-[length:var(--text-pipeline-caption,12px)]",
  "leading-[var(--text-pipeline-caption--line-height,16px)]",
].join(" ");

const activeTabClasses = [
  tabSharedClasses,
  "bg-[color:var(--color-pipeline-surface)]",
  "text-[color:var(--color-pipeline-ink)]",
  "cursor-default",
].join(" ");

// Both tabs are interactive (issue #755); disabled-tab styling is retired.
const inactiveTabClasses = [
  tabSharedClasses,
  "bg-transparent",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "cursor-pointer",
].join(" ");

// Label wrapper (LabelCont) — 6px horizontal padding inside the tab chip.
const tabLabelClasses = "flex items-center justify-center px-1.5";

const badgeClasses = [
  "inline-flex items-center justify-center",
  "min-w-5 px-1 py-0.5",
  // Badge: 4px radius (--radius-pipeline-card).
  "rounded-[var(--radius-pipeline-card)]",
  "bg-[color:var(--color-pipeline-fill-muted)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "font-normal",
  "text-[length:var(--text-pipeline-caption,12px)]",
  "leading-[var(--text-pipeline-caption--line-height,16px)]",
].join(" ");

// Badge inner LabelCont — 2px horizontal padding around the count (size-2).
const badgeLabelClasses = "flex items-center justify-center px-0.5";

interface TabButtonProps {
  selected: boolean;
  onSelect: () => void;
  label: string;
  count: number;
  "data-testid": string;
  countTestId: string;
}

function TabButton({
  selected,
  onSelect,
  label,
  count,
  countTestId,
  ...rest
}: TabButtonProps) {
  return (
    <button
      type="button"
      className={selected ? activeTabClasses : inactiveTabClasses}
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      {...rest}
    >
      <span className={tabLabelClasses}>{label}</span>
      <span className={badgeClasses} data-testid={countTestId}>
        <span className={badgeLabelClasses}>{count}</span>
      </span>
    </button>
  );
}

interface LoanBookTabBarProps {
  activeTab: LoanBookTab;
  onSelect: (tab: LoanBookTab) => void;
  activeLoansCount: number;
  inOriginationCount: number;
}

function LoanBookTabBar({
  activeTab,
  onSelect,
  activeLoansCount,
  inOriginationCount,
}: LoanBookTabBarProps) {
  return (
    // spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel (tab track responsive width)
    <div
      className="flex w-full items-start rounded-[var(--radius-pipeline-card-sm)] bg-[color:var(--color-pipeline-fill-muted)] p-0.5 md:w-auto md:self-start"
      data-testid="loan-book-tab-bar"
      role="tablist"
    >
      <TabButton
        selected={activeTab === "active"}
        onSelect={() => onSelect("active")}
        label="Active Loans"
        count={activeLoansCount}
        data-testid="loan-book-tab-active-loans"
        countTestId="loan-book-tab-active-loans-count"
      />
      <TabButton
        selected={activeTab === "origination"}
        onSelect={() => onSelect("origination")}
        label="In Origination"
        count={inOriginationCount}
        data-testid="loan-book-tab-in-origination"
        countTestId="loan-book-tab-in-origination-count"
      />
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

// spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel (In Origination tab body state)
interface OriginationTabBodyProps {
  state: ReturnType<typeof useDeploymentMonitorPanel>["originationState"];
  rows: ReturnType<typeof useDeploymentMonitorPanel>["originationRows"];
  errorMessage: string | undefined;
  onRetry: () => void;
}

function OriginationTabBody({
  state,
  rows,
  errorMessage,
  onRetry,
}: OriginationTabBodyProps) {
  switch (state) {
    case "loading":
      return <PanelLoading data-testid="loan-book-origination-loading" />;
    case "error":
      return (
        <PanelError
          data-testid="loan-book-origination-error"
          onRetry={onRetry}
          message={errorMessage}
        />
      );
    case "empty":
      return (
        <PanelEmpty
          data-testid="loan-book-origination-empty"
          caption="No loans in origination"
        />
      );
    case "ready":
    default:
      return <OriginationTable rows={rows} />;
  }
}

export function DeploymentMonitorPanel() {
  const {
    state,
    summary,
    rows,
    headerAggregates,
    activeLoansCount,
    errorMessage,
    refetch,
    activeTab,
    setActiveTab,
    originationRows,
    inOriginationCount,
    originationState,
    originationErrorMessage,
    refetchOrigination,
  } = useDeploymentMonitorPanel();

  return (
    <PanelContainer
      title="Loan Book"
      state={state}
      onRetry={refetch}
      errorMessage={errorMessage}
      borderless
      data-testid="dashboard-panel-deployment-monitor"
      data-node-id="3283:14431"
    >
      {/* spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel (section spacing) */}
      <div className="flex flex-col gap-8">
        <LoanBookSummary
          totalDeployed={summary.totalDeployed}
          totalCollateral={summary.totalCollateral}
          seniorDebtCoverage={summary.seniorDebtCoverage}
          avgYield={summary.avgYield}
          avgDuration={summary.avgDuration}
        />
        {/* spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel (tab-bar/table container card) */}
        <div
          className={[
            "flex flex-col gap-6 p-4",
            "bg-[color:var(--color-pipeline-surface)]",
            "rounded-[var(--radius-pipeline-card)]",
            "border-t border-l border-[color:var(--color-pipeline-line)]",
            "border-r-[3px] border-b-[3px] border-r-[color:var(--color-pipeline-line)] border-b-[color:var(--color-pipeline-line)]",
          ].join(" ")}
          data-testid="loan-book-table-container"
        >
          <LoanBookTabBar
            activeTab={activeTab}
            onSelect={setActiveTab}
            activeLoansCount={activeLoansCount}
            inOriginationCount={inOriginationCount}
          />
          {activeTab === "active" ? (
            rows.length === 0 ? (
              <PanelEmpty
                data-testid="loan-book-active-empty"
                caption="No active loans"
              />
            ) : (
              <LoanBookTable rows={rows} headerAggregates={headerAggregates} />
            )
          ) : (
            <OriginationTabBody
              state={originationState}
              rows={originationRows}
              errorMessage={originationErrorMessage}
              onRetry={refetchOrigination}
            />
          )}
        </div>
      </div>
    </PanelContainer>
  );
}

export default DeploymentMonitorPanel;

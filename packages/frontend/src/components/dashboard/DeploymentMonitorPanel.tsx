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
 * Both tabs are selectable and carry a live count badge: Active Loans shows
 * `loans.length` from `GET /v1/loan-book`; In Origination shows the submission
 * count from `GET /v1/loan-book/submissions` (issue #755). The In Origination
 * table reuses the same layout with an added Status column and derives its rows
 * from each submission's `loan_data` payload.
 *
 * Figma:
 *   Desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431
 *   Mobile:  https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72323
 */
import { PanelContainer } from "./PanelContainer";
import { LoanBookSummary } from "./LoanBookSummary";
import { LoanBookTable } from "./LoanBookTable";
import { PanelLoading } from "./PanelLoading";
import { PanelError } from "./PanelError";
import { PanelEmpty } from "./PanelEmpty";
import {
  useDeploymentMonitorPanel,
  type LoanBookTab,
} from "./useDeploymentMonitorPanel";

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

// Tab bar — Figma node 3283:72372 (mobile) / 3283:14480 (desktop).
//
// Container: full-width (flex-1 tabs fill the track), muted fill bg
// (rgba(184,191,190,0.12) = --color-pipeline-fill-muted), 2px padding,
// radius-xl = 6px track (--radius-pipeline-card-sm).
//
// Each tab: flex-1 (fills half the track), h=32px, px=6px, radius-l = 4px
// (--radius-pipeline-card). Active tab: white bg (--color-pipeline-surface),
// medium weight ink label. Disabled tab: transparent bg, muted ink label,
// 50% opacity, not-allowed cursor.
//
// Badge: muted fill bg, 4px radius (--radius-pipeline-card), caption-size
// Regular, muted ink, min-width 20px, horizontal padding 4px, vertical padding 2px.
// (Figma specifies backdrop-blur on badge — omitted: no blur token exists
// and it's invisible on the flat panel background.)

const tabSharedClasses = [
  "flex flex-1 items-center justify-center gap-1",
  "h-8 px-1.5",
  // Figma radius-l = 4px (segmented-tab corner) — NOT a full pill.
  "rounded-[var(--radius-pipeline-card)]",
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

// Unselected (but selectable) tab: transparent bg, muted ink, Regular weight,
// pointer cursor. Both tabs are now interactive (issue #755) — the previous
// `disabledTabClasses` (opacity-50 / cursor-not-allowed) is retired.
const inactiveTabClasses = [
  tabSharedClasses,
  "bg-transparent",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "font-normal",
  "cursor-pointer",
].join(" ");

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
  const activeSelected = activeTab === "active";
  const originationSelected = activeTab === "origination";
  return (
    <div
      className="flex w-full items-start rounded-[var(--radius-pipeline-card-sm)] bg-[color:var(--color-pipeline-fill-muted)] p-0.5"
      data-testid="loan-book-tab-bar"
      role="tablist"
    >
      <button
        type="button"
        className={activeSelected ? activeTabClasses : inactiveTabClasses}
        role="tab"
        aria-selected={activeSelected}
        onClick={() => onSelect("active")}
        data-testid="loan-book-tab-active-loans"
      >
        Active Loans
        <span
          className={badgeClasses}
          data-testid="loan-book-tab-active-loans-count"
        >
          {activeLoansCount}
        </span>
      </button>
      <button
        type="button"
        className={originationSelected ? activeTabClasses : inactiveTabClasses}
        role="tab"
        aria-selected={originationSelected}
        onClick={() => onSelect("origination")}
        data-testid="loan-book-tab-in-origination"
      >
        In Origination
        <span
          className={badgeClasses}
          data-testid="loan-book-tab-in-origination-count"
        >
          {inOriginationCount}
        </span>
      </button>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

// In Origination tab body — renders its own loading/error/empty/ready state
// (independent of the panel-level Active Loans state) so a slow or failed
// submissions fetch never blanks the whole panel.
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
      return <LoanBookTable rows={rows} showStatus />;
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
      {/*
       * Spacing from Figma node 3283:14431 (Section):
       *   heading h=56, cards start y=88 → 32px heading→cards gap.
       *   PanelContainer (borderless) contributes gap-4 (16px) between <h2>
       *   and body div. pt-4 (16px) on this wrapper adds the remaining 16px
       *   → 32px total heading-to-cards.
       *   gap-8 (32px) between LoanBookSummary and the table container:
       *   cards end y=232, Container starts y=264 → 32px below cards.
       */}
      <div className="flex flex-col gap-8 pt-4">
        <LoanBookSummary
          totalDeployed={summary.totalDeployed}
          totalCollateral={summary.totalCollateral}
          seniorDebtCoverage={summary.seniorDebtCoverage}
          avgYield={summary.avgYield}
          avgDuration={summary.avgDuration}
        />
        {/*
         * Tab bar + table container (Figma node 3283:14479) — bordered card:
         *   border-radius: var(--radius-radius-xxl, 4px) = --radius-pipeline-card
         *   border-top/left: 1px solid border-test/secondary = --color-pipeline-line
         *   border-right/bottom: 3px solid border-test/secondary = --color-pipeline-line
         *   background: fill-test/on-primary = --color-pipeline-surface (white)
         *   Same asymmetric "depth" border as the summary cards (LoanBookSummary).
         *
         *   Inner padding: tabs at x=16, y=16 → p-4 (16px all sides).
         *   gap-6 (24px) tabs→table: tabs bottom y=52, table top y=76 → 24px.
         */}
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

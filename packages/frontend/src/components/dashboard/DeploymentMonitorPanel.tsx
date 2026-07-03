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

// Figma nodes 3283:14480 (desktop) / 3283:72372 (mobile) — segmented control.
//
// Responsive width behaviour (the two Figma variants are structurally identical
// — `flex-1` tabs in a `size-full` track — but render differently by context):
//   - Desktop (md+, node 3283:14480): the track HUGS its content and sits
//     left-aligned; tabs are sized to their own label+badge (NOT split 50/50).
//     → `md:w-auto md:self-start` on the track, `md:flex-none` on the tabs.
//   - Mobile (<md, node 3283:72372): the track fills the section width and the
//     two tabs split it equally. → `w-full` track, `flex-1` tabs.
//
// Container (.tabs): muted fill track (--color-pipeline-fill-muted =
// fill-test/primary), 2px padding (size-2), radius-xl = 6px
// (--radius-pipeline-card-sm).
//
// Each .tab: h=32px (h-8), min-w=32px (min-w-8), px=6px (size-6 → px-1.5),
// radius-l = 4px (--radius-pipeline-card), gap-0. The label sits in its own
// LabelCont with 6px horizontal padding (px-1.5). Both tabs use caption-size
// Medium (500) — the selected/unselected tabs differ only by background
// (white chip vs transparent) and text colour (ink vs ink-muted), NOT weight.
//
// Badge: muted fill bg (fill-test/primary), 4px radius (--radius-pipeline-card),
// caption-size Regular ink-muted, min-width 20px (min-w-5), outer px 4px (px-1)
// + inner LabelCont px 2px (px-0.5), py 2px (py-0.5).
// (Figma specifies a background-blur on the badge — omitted: no blur token
// exists and it's invisible over the flat panel background.)

const tabSharedClasses = [
  // Mobile: fill half the track. Desktop: size to content.
  "flex flex-1 md:flex-none items-center justify-center gap-0",
  "h-8 min-w-8 px-1.5",
  // Figma radius-l = 4px (segmented-tab corner) — NOT a full pill.
  "rounded-[var(--radius-pipeline-card)]",
  "font-[family-name:var(--font-body)]",
  // Both tabs are Medium (500) per Figma — selection is conveyed by bg + colour.
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

// Unselected (but selectable) tab: transparent bg, muted ink, pointer cursor.
// Both tabs are interactive (issue #755) — the previous `disabledTabClasses`
// (opacity-50 / cursor-not-allowed) is retired.
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
    // Mobile: full-width track (tabs split it). Desktop (md+): track hugs its
    // content and left-aligns (self-start) — it does NOT stretch to the panel
    // width (Figma node 3283:14480).
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

import { PanelContainer } from "./PanelContainer";

/**
 * YieldHistoryPanel — Protocol Dashboard Panel D (placeholder).
 *
 * Renders the shared `PanelContainer` with the panel title and an empty
 * "Coming soon" body. Real content (the cumulative-yield chart in the
 * dashboard's top charts row — Figma node `3283:67619`) lands in a follow-up
 * sub-issue of #712; this file stays thin so that issue only fills the body.
 */
export function YieldHistoryPanel() {
  return (
    <PanelContainer
      title="Yield History"
      state="empty"
      emptyCaption="Coming soon"
      data-testid="dashboard-panel-yield-history"
      data-node-id="3283:67619"
    />
  );
}

export default YieldHistoryPanel;

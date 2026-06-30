import { PanelContainer } from "./PanelContainer";

/**
 * BalanceSheetPanel — Protocol Dashboard Panel A (placeholder).
 *
 * Renders the shared `PanelContainer` with the panel title and an empty
 * "Coming soon" body. Real content (the protocol's Statement of Financial
 * Position — Figma section node `3283:14275`) lands in a follow-up sub-issue
 * of #712; this file stays thin so that issue only fills the body.
 */
export function BalanceSheetPanel() {
  return (
    <PanelContainer
      title="Balance Sheet"
      state="empty"
      emptyCaption="Coming soon"
      data-testid="dashboard-panel-balance-sheet"
      data-node-id="3283:14275"
    />
  );
}

export default BalanceSheetPanel;

import { PanelContainer } from "./PanelContainer";

/**
 * WithdrawalQueuePanel — Protocol Dashboard Panel C (placeholder).
 *
 * Renders the shared `PanelContainer` with the panel title and an empty
 * "Coming soon" body. Real content (the protocol withdrawal queue — Figma
 * section node `3283:14893`) lands in a follow-up sub-issue of #712; this file
 * stays thin so that issue only fills the body.
 */
export function WithdrawalQueuePanel() {
  return (
    <PanelContainer
      title="Withdrawal Queue"
      state="empty"
      emptyCaption="Coming soon"
      data-testid="dashboard-panel-withdrawal-queue"
      data-node-id="3283:14893"
    />
  );
}

export default WithdrawalQueuePanel;

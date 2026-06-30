import { PanelContainer } from "./PanelContainer";

/**
 * DeploymentMonitorPanel — Protocol Dashboard Panel B (placeholder).
 *
 * Renders the shared `PanelContainer` with the panel title and an empty
 * "Coming soon" body. Real content (the Loan Book / deployment table — Figma
 * section node `3283:14431`) lands in a follow-up sub-issue of #712; this file
 * stays thin so that issue only fills the body.
 */
export function DeploymentMonitorPanel() {
  return (
    <PanelContainer
      title="Deployment Monitor"
      state="empty"
      emptyCaption="Coming soon"
      data-testid="dashboard-panel-deployment-monitor"
      data-node-id="3283:14431"
    />
  );
}

export default DeploymentMonitorPanel;

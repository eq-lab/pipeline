import { createFileRoute, Outlet } from "@tanstack/react-router";

// spec: docs/frontend/trustee-flows.md#routing (Risk Council pass-through layout).
function RiskCouncilLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/risk-council")({
  component: RiskCouncilLayout,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";

// spec: docs/frontend/trustee-flows.md#lp-counterparties.
function LpCounterpartiesLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/lp-counterparties")({
  component: LpCounterpartiesLayout,
});

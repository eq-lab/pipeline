import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Risk Council layout route — a pass-through that renders its child route via
 * `<Outlet/>` and adds no chrome of its own (issue #782, mirrors the `loans.tsx`
 * / `origination.tsx` precedent, #821). It exists so sibling pages can both
 * live under `/risk-council`:
 *   - `risk-council.index.tsx`         → the placeholder body at `/risk-council`
 *     (#786's nav taxonomy, pending the Type-3 flow index).
 *   - `risk-council.escalate.$id.tsx`  → the Escalate-to-Default page at
 *     `/risk-council/escalate/$id` (#782).
 *
 * Without this layout, TanStack's generated route tree would reference a
 * `RiskCouncilRoute` parent with no `<Outlet/>`, so `/risk-council/escalate/$id`
 * would fail to register (renders "not found") — the same fix `loans.tsx`'s
 * doc comment describes for `/loans/$id`.
 */
function RiskCouncilLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/risk-council")({
  component: RiskCouncilLayout,
});

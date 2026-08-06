import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pass-through layout so `origination.index.tsx` (`/origination`) and
// `origination.$id.tsx` (`/origination/$id`) can both live under `/origination`.
// spec: docs/frontend/trustee-flows.md#routing.
function OriginationLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/origination")({
  component: OriginationLayout,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pass-through layout so `loans.index.tsx` (`/loans`) and `loans.$id.tsx`
// (`/loans/$id`) can both live under `/loans`. spec: docs/frontend/trustee-flows.md#routing.
function LoansLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/loans")({
  component: LoansLayout,
});

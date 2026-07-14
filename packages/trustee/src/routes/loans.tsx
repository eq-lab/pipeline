import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Loans layout route — a pass-through that renders its child route via
 * `<Outlet/>` and adds no chrome of its own. It exists so the two sibling
 * pages can both live under `/loans`:
 *   - `loans.index.tsx` → the active-loan table at `/loans` (#843)
 *   - `loans.$id.tsx`   → the loan detail page at `/loans/$id` (#847/#845)
 *
 * Without this layout, TanStack's generated route tree references a `LoansRoute`
 * parent that has no definition, so `/loans/$id` fails to register (renders
 * "not found") — same fix as the Origination routing (#821). This replaces the
 * temporary in-page "fake navigation" (#847), now that the loan-book endpoint
 * serves a real `loan_id` to route on.
 */
function LoansLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/loans")({
  component: LoansLayout,
});

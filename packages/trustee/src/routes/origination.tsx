import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Origination layout route — a pass-through that renders its child route via
 * `<Outlet/>` and adds no chrome of its own. It exists so the two sibling
 * pages can both live under `/origination`:
 *   - `origination.index.tsx` → the submissions table at `/origination`
 *   - `origination.$id.tsx`   → the details/review page at `/origination/$id`
 *
 * Without this layout, TanStack's generated route tree references an
 * `OriginationRoute` parent that has no definition, so `/origination/$id`
 * fails to register (renders "not found") — see #821.
 */
function OriginationLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/origination")({
  component: OriginationLayout,
});

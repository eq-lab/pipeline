import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/TopBar";

/**
 * Transactions / Activity route — placeholder.
 *
 * Full page composition lands in Issue #125. This file exists so
 * TanStackRouterVite picks up the `/transactions` route and regenerates
 * the route tree; the TopBar is rendered with `activeNav="history"` per
 * the Issue body so the page is visually anchored under the right nav
 * slot even before the body is built.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94912&m=dev
 */
function Transactions() {
  return (
    <>
      <TopBar activeNav="history" />
      {/* TODO(#125): compose the transactions/activity page body. */}
    </>
  );
}

export const Route = createFileRoute("/transactions")({
  component: Transactions,
});

import { createFileRoute } from "@tanstack/react-router";

/**
 * Deposit route — placeholder body.
 *
 * The full page composition lands in D14 (Issue #113). This file exists so
 * TanStackRouterVite picks up the `/deposit` route and regenerates the route
 * tree, enabling the TopBar dollar icon to navigate here.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100130&m=dev
 */
function Deposit() {
  return <main>Deposit</main>;
}

export const Route = createFileRoute("/deposit")({
  component: Deposit,
});
